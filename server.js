// server.js
const express = require("express");
const path = require("path");
const axios = require("axios");

const { getRoutes } = require("./backend/routeConfig");
const { buildDotState } = require("./backend/dotState");
const { fetchDailyScheduleRaw } = require("./backend/wsdotClient");


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

app.listen(PORT, () => {
  console.log(`FerryAPI3 listening on http://localhost:${PORT}`);
});
