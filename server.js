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

async function buildScheduleForRoute(routeId) {
  const route = getRouteById(routeId);
  if (!route) {
    console.warn("[schedule] No route for id", routeId);
    return null;
  }

  const now = new Date();
  const nowMs = now.getTime();
  const tripDateText = now.toISOString().slice(0, 10);

  const raw = await fetchDailyScheduleRaw(route.routeId, tripDateText);

  let combos;
  if (raw && typeof raw === "object" && Array.isArray(raw.TerminalCombos)) {
    combos = raw.TerminalCombos;
  } else if (Array.isArray(raw)) {
    combos = raw;
  } else {
    console.warn("[schedule] Unexpected schedule shape for route", routeId, {
      typeofRaw: typeof raw,
      isArray: Array.isArray(raw)
    });
    combos = [];
  }

  const base = {
    route: {
      routeId: route.routeId,
      description: route.description,
      terminalNameWest: route.terminalNameWest,
      terminalNameEast: route.terminalNameEast
    },
    date: tripDateText,
    west: [],
    east: []
  };

  if (!combos.length) {
    return base;
  }

  let terminalIdWest = null;
  let terminalIdEast = null;

  const nameWest = route.terminalNameWest
    ? String(route.terminalNameWest).trim().toLowerCase()
    : null;
  const nameEast = route.terminalNameEast
    ? String(route.terminalNameEast).trim().toLowerCase()
    : null;

  for (const combo of combos) {
    if (!combo) continue;

    const depNameRaw = combo.DepartingTerminalName;
    const depId = combo.DepartingTerminalID;

    if (depNameRaw == null || depId == null) continue;

    const depName = String(depNameRaw).trim().toLowerCase();

    if (nameWest && !terminalIdWest && depName === nameWest) {
      terminalIdWest = Number(depId);
    }

    if (nameEast && !terminalIdEast && depName === nameEast) {
      terminalIdEast = Number(depId);
    }

    if (terminalIdWest != null && terminalIdEast != null) {
      break;
    }
  }

  if (terminalIdWest == null || terminalIdEast == null) {
    console.warn("[schedule] Could not resolve terminal IDs for route", routeId, {
      nameWest,
      nameEast
    });
    return base;
  }

  function collectDepartures(fromId, toId) {
    const result = [];

    for (const combo of combos) {
      if (!combo) continue;

      const depId = combo.DepartingTerminalID ?? null;
      const arrId = combo.ArrivingTerminalID ?? null;

      if (Number(depId) !== Number(fromId) || Number(arrId) !== Number(toId)) {
        continue;
      }

      const times = Array.isArray(combo.Times) ? combo.Times : [];

      for (const t of times) {
        if (!t) continue;
        if (t.IsCancelled === true) continue;

        const d = parseWsdotDate(t.DepartingTime);
        if (!d) continue;

        const dMs = d.getTime();
        if (dMs <= nowMs) continue;

        result.push({
          departureTimeIso: d.toISOString(),
          vesselName: t.VesselName ?? null,
          vesselId: t.VesselID ?? null
        });
      }
    }

    result.sort((a, b) => {
      const aMs = Date.parse(a.departureTimeIso) || 0;
      const bMs = Date.parse(b.departureTimeIso) || 0;
      return aMs - bMs;
    });

    return result;
  }

  const west = collectDepartures(terminalIdWest, terminalIdEast);
  const east = collectDepartures(terminalIdEast, terminalIdWest);

  return {
    ...base,
    west,
    east
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
