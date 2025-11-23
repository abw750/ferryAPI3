// backend/wsdotClient.js
// Centralized WSDOT client:
// - Handles all HTTP calls to /vessellocations
// - Parses WSDOT date strings
// - Normalizes vessel records into a stable shape for consumers.

const axios = require("axios");

// ---------------------------------------------------------------------------
// Stage 1: Daily Schedule Fetcher (Cannon Section 3 & 5)
// ---------------------------------------------------------------------------
//
// This fetches the *daily* schedule for a given route, normalized down to only
// the fields Cannon needs for LaneVessels:
//   - routeId
//   - departingTerminalId
//   - vesselPositionNumber (1 or 2)
//   - vesselId
//   - vesselName
//
// All lane identity derives from this schedule, not from live vessel direction.
// ---------------------------------------------------------------------------
// TEMP: Raw schedule fetcher for debugging schedule payload shape
async function fetchDailyScheduleRaw(routeId, tripDateText) {
  const apiKey = requireApiKey();

  const url =
    `https://www.wsdot.wa.gov/Ferries/API/Schedule/rest/schedule/` +
    `${encodeURIComponent(tripDateText)}/` +
    `${encodeURIComponent(routeId)}?apiaccesscode=${encodeURIComponent(apiKey)}`;

  const res = await axios.get(url, {
    timeout: 8000,
    headers: { Accept: "application/json" },
  });

  // For debugging, we return the raw data (object or array).
  return res && typeof res.data !== "undefined" ? res.data : null;
}

async function fetchDailySchedule(routeId, tripDateText) {
  const apiKey = requireApiKey();

  // Example URL per Cannon:
  //   Ferries/API/Schedule/rest/schedule/{TripDateText}/{Route}?apiaccesscode=...
  const url =
    `https://www.wsdot.wa.gov/Ferries/API/Schedule/rest/schedule/` +
    `${encodeURIComponent(tripDateText)}/` +
    `${encodeURIComponent(routeId)}?apiaccesscode=${encodeURIComponent(apiKey)}`;

  const res = await axios.get(url, {
    timeout: 8000,
    headers: { Accept: "application/json" },
  });

  const data = res && res.data;

  // New: schedule payload is an object with TerminalCombos[].Times[]
  if (!data || typeof data !== "object") {
    throw new Error("Unexpected schedule payload (no object data)");
  }

  const combos = Array.isArray(data.TerminalCombos) ? data.TerminalCombos : [];
  const rows = [];

  for (const combo of combos) {
    const departingTerminalId = combo.DepartingTerminalID ?? null;
    const times = Array.isArray(combo.Times) ? combo.Times : [];

    for (const t of times) {
      const vesselPositionNumber = t.VesselPositionNum ?? null;
      const vesselId = t.VesselID ?? null;
      const vesselName = t.VesselName ?? null;

      // Route is usually [5]; fall back to requested routeId if missing.
      const rowRouteId =
        Array.isArray(t.Routes) && t.Routes.length > 0
          ? t.Routes[0]
          : routeId;

      rows.push({
        routeId: rowRouteId,
        departingTerminalId,
        vesselPositionNumber,
        vesselId,
        vesselName,
      });
    }
  }

  // Empty array is OK; deriveLaneVesselsForRoute will mark scheduleError.
  return rows;
}

const WSDOT_BASE = "https://www.wsdot.wa.gov/Ferries/API/Vessels/rest";

function requireApiKey() {
  const key = process.env.WSDOT_API_KEY;
  if (!key) {
    throw new Error("WSDOT_API_KEY environment variable is not set");
  }
  return key;
}

// WSDOT date format: "/Date(1763623116000-0800)/"
function parseWsdotDate(raw) {
  if (!raw) return null;
  const m = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(String(raw));
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeVessel(rec) {
  if (!rec) return null;

  return {
    vesselId: rec.VesselID,
    vesselName: rec.VesselName,
    departingId: rec.DepartingTerminalID,
    departingName: rec.DepartingTerminalName,
    arrivingId: rec.ArrivingTerminalID,
    arrivingName: rec.ArrivingTerminalName,
    atDock: !!rec.AtDock,
    vesselPositionNumber: rec.VesselPositionNum,
    leftDockIso: parseWsdotDate(rec.LeftDock),
    etaIso: parseWsdotDate(rec.Eta),
    scheduledDepartureIso: parseWsdotDate(rec.ScheduledDeparture),
    timeStampIso: parseWsdotDate(rec.TimeStamp),
    opRouteAbbrev: Array.isArray(rec.OpRouteAbbrev)
      ? rec.OpRouteAbbrev
      : [],
  };
}

async function getNormalizedVessels() {
  const apiKey = requireApiKey();
  const url = `${WSDOT_BASE}/vessellocations?apiaccesscode=${encodeURIComponent(
    apiKey
  )}`;

  const res = await axios.get(url, {
    timeout: 8000,
    headers: { Accept: "application/json" },
  });

  if (!res || !Array.isArray(res.data)) {
    throw new Error("Unexpected vessellocations payload");
  }

  return res.data.map(normalizeVessel).filter(Boolean);
}

module.exports = {
  getNormalizedVessels,
  fetchDailySchedule,
  fetchDailyScheduleRaw, 
};
