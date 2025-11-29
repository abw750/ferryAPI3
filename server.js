// server.js
const express = require("express");
const path = require("path");
const axios = require("axios");

const { getRoutes, getRouteById } = require("./backend/routeConfig");
const { buildDotState } = require("./backend/dotState");
const {
  fetchDailyScheduleRaw,
  fetchTerminalSpaces,
} = require("./backend/wsdotClient");


// Polyfills (harmless on newer Node; required on 14)
if (!Object.hasOwn) {
  Object.hasOwn = function (obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}
if (!String.prototype.replaceAll) {
  // naive but sufficient for error templates
  // eslint-disable-next-line no-extend-native
  String.prototype.replaceAll = function (search, replacement) {
    return this.split(search).join(replacement);
  };
}

const app = express();
const PORT = process.env.PORT || 8000;

app.get("/", (req, res) => {
  res.redirect("/mobile/");
});

// ---- Static UI ----
app.use(express.static(path.join(__dirname, "public")));

// ---- Health check ----
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    node: process.version,
  });
});

// ---- WSDOT debug endpoint: embedded API call ----
app.get("/api/wsdot-vessels-debug", async (req, res) => {
  const apiKey = process.env.WSDOT_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "WSDOT_API_KEY environment variable is not set",
    });
  }

  const url =
    "https://www.wsdot.wa.gov/Ferries/API/Vessels/rest/vessellocations" +
    "?apiaccesscode=" +
    encodeURIComponent(apiKey);

  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: { Accept: "application/json" },
    });

    const rows = Array.isArray(response.data) ? response.data : [];

    res.json({
      count: rows.length,
      sample: rows.slice(0, 3),
    });
  } catch (err) {
    const status = err.response && err.response.status;
    const data = err.response && err.response.data;

    console.error(
      "Error calling WSDOT vessellocations:",
      err.message || String(err),
      status
    );

    res.status(500).json({
      error: "Failed to fetch vessellocations",
      message: err.message || String(err),
      status,
      data,
    });
  }
});

// ---- Routes list (mock routeConfig) ----
app.get("/api/routes", (req, res) => {
  res.json({ routes: getRoutes() });
});

// ---- Remaining schedule for today (per route) ----
app.get("/api/schedule", async (req, res) => {
  try {
    const routeId = Number(req.query.routeId) || 5;
    const schedule = await buildScheduleForRoute(routeId);

    if (!schedule) {
      return res.status(404).json({ error: "No schedule for this route" });
    }

    res.json(schedule);
  } catch (err) {
    console.error("Error in /api/schedule:", err);
    res.status(500).json({ error: "Internal error building schedule" });
  }
});

// ---- Dot state (still mock behind buildDotState) ----
app.get("/api/dot-state", async (req, res) => {
  const routeId = parseInt(req.query.routeId, 10) || 5;

  try {
    const state = await buildDotState(routeId);
    if (!state) {
      return res.status(404).json({ error: "Unknown routeId" });
    }
    res.json(state);
  } catch (err) {
    console.error("Error in /api/dot-state:", err);
    res.status(500).json({ error: "Internal error building dot state" });
  }
});

// Simple WSDOT /Date(…)/ parser for schedule timestamps.
function parseWsdotDate(raw) {
  if (!raw) return null;
  const m = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(String(raw));
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function formatLocalYmd(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

async function buildScheduleForRoute(routeId) {
  const route = getRouteById(routeId);
  if (!route) {
    console.warn("[schedule] No route for id", routeId);
    return null;
  }

  // --- local helpers ---
  function formatLocalYmd(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  const now = new Date();

  // Fetch TODAY + TOMORROW schedules (unfiltered).
  const todayYmd = formatLocalYmd(now);

  const tomorrow = new Date(now.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYmd = formatLocalYmd(tomorrow);

  const [rawToday, rawTomorrow] = await Promise.all([
    fetchDailyScheduleRaw(route.routeId, todayYmd),
    fetchDailyScheduleRaw(route.routeId, tomorrowYmd),
  ]);

  // Function to extract TerminalCombos reliably
  function extractCombos(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw.TerminalCombos)) return raw.TerminalCombos;
    return [];
  }

  const combosToday = extractCombos(rawToday);
  const combosTomorrow = extractCombos(rawTomorrow);

  const base = {
    route: {
      routeId: route.routeId,
      description: route.description,
      terminalNameWest: route.terminalNameWest,
      terminalNameEast: route.terminalNameEast
    },
    date: todayYmd,
    west: [],
    east: [],
  };

  // Resolve terminal IDs once using TODAY’s combos
  let terminalIdWest = null;
  let terminalIdEast = null;

  const nameWest = route.terminalNameWest.trim().toLowerCase();
  const nameEast = route.terminalNameEast.trim().toLowerCase();

  for (const combo of combosToday) {
    if (!combo) continue;
    const depName = String(combo.DepartingTerminalName || "").trim().toLowerCase();
    const depId = combo.DepartingTerminalID;

    if (!terminalIdWest && depName === nameWest) terminalIdWest = Number(depId);
    if (!terminalIdEast && depName === nameEast) terminalIdEast = Number(depId);
    if (terminalIdWest && terminalIdEast) break;
  }

  if (!terminalIdWest || !terminalIdEast) {
    console.warn("[schedule] Could not resolve terminal IDs for route", routeId);
    return base;
  }

  // Extract all departures from both days into unified lists
  function collectDepartures(fromId, toId, combos) {
    const result = [];
    for (const combo of combos) {
      if (!combo) return;
      if (combo.DepartingTerminalID !== fromId) continue;
      if (combo.ArrivingTerminalID !== toId) continue;

      const times = Array.isArray(combo.Times) ? combo.Times : [];
      for (const t of times) {
        if (!t || t.IsCancelled) continue;
        const d = parseWsdotDate(t.DepartingTime);
        if (!d) continue;

        result.push({
          departureTimeIso: d.toISOString(),
          vesselName: t.VesselName ?? null,
          vesselId: t.VesselID ?? null,
        });
      }
    }
    return result;
  }

  const westAll = [
    ...collectDepartures(terminalIdWest, terminalIdEast, combosToday),
    ...collectDepartures(terminalIdWest, terminalIdEast, combosTomorrow),
  ];

  const eastAll = [
    ...collectDepartures(terminalIdEast, terminalIdWest, combosToday),
    ...collectDepartures(terminalIdEast, terminalIdWest, combosTomorrow),
  ];

  // Sort chronologically
  westAll.sort((a, b) => Date.parse(a.departureTimeIso) - Date.parse(b.departureTimeIso));
  eastAll.sort((a, b) => Date.parse(a.departureTimeIso) - Date.parse(b.departureTimeIso));

  // Return everything; client will filter by service-day + 12-hour rule
  return {
    ...base,
    west: westAll,
    east: eastAll,
  };
}

// DEBUG: inspect raw WSDOT schedule payload
app.get("/api/debug/schedule", async (req, res) => {
  try {
    const routeId = Number(req.query.routeId) || 5;

    const today = new Date();
    const tripDateText =
      typeof req.query.date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
        ? req.query.date
        : today.toISOString().slice(0, 10);

    const raw = await fetchDailyScheduleRaw(routeId, tripDateText);

    res.json({
      routeId,
      tripDateText,
      typeofData: typeof raw,
      isArray: Array.isArray(raw),
      keys:
        raw && !Array.isArray(raw) && typeof raw === "object"
          ? Object.keys(raw)
          : null,
      sample:
        Array.isArray(raw) ? raw.slice(0, 3) : raw,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});
/// DEBUG: compare dot-state capacity vs raw terminalsailingspace
app.get("/api/debug/capacity", async (req, res) => {
  try {
    const routeId = Number(req.query.routeId) || 5;

    const [state, rawSpaces] = await Promise.all([
      buildDotState(routeId),
      fetchTerminalSpaces(),
    ]);

    const capacityFromDotState = state && state.capacity ? state.capacity : null;
    const capacityMeta =
      state && state.meta
        ? {
            capacityStale: !!state.meta.capacityStale,
            lastUpdatedCapacity: state.meta.lastUpdatedCapacity || null,
          }
        : null;

              // Filter to only Seattle (7) and Bainbridge Island (3)
      const filtered = Array.isArray(rawSpaces)
        ? rawSpaces.filter(r => r.TerminalID === 3 || r.TerminalID === 7)
        : [];

    res.json({
      routeId,
      capacityFromDotState,
      capacityMeta,
      rawSample: filtered,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

// DEBUG: see raw routedetails for a route
app.get("/api/debug/routedetails", async (req, res) => {
  try {
    const routeId = Number(req.query.routeId) || 5;
    const today = new Date().toISOString().slice(0, 10);

    const raw = await fetchRouteDetails(routeId, today);

    res.json({
      routeId,
      tripDateText: today,
      typeofData: typeof raw,
      isArray: Array.isArray(raw),
      keys: raw && typeof raw === "object" && !Array.isArray(raw)
        ? Object.keys(raw)
        : null,
      sample: Array.isArray(raw) ? raw.slice(0, 3) : raw,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`FerryAPI3 listening on http://localhost:${PORT}`);
});
