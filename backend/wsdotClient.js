// backend/wsdotClient.js
// Centralized WSDOT client:
// - Handles all HTTP calls to /vessellocations
// - Handles schedule + routedetails
// - Handles terminalsailingspace for capacity pies
// - Parses WSDOT date strings
// - Normalizes vessel records into a stable shape for consumers.

const axios = require("axios");

// Small retry/backoff wrapper for flaky WSDOT endpoints (Cannon Section 9).
function isRetryableError(err) {
  if (!err) return false;

  // Axios timeout or network errors
  if (err.code && (
    err.code === "ECONNABORTED" ||
    err.code === "ECONNRESET" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ENETUNREACH" ||
    err.code === "EAI_AGAIN"
  )) {
    return true;
  }

  // HTTP 5xx
  const status = err.response && err.response.status;
  if (typeof status === "number" && status >= 500 && status < 600) {
    return true;
  }

  return false;
}

async function getWithRetry(url, options, maxAttempts = 2, backoffMs = 500) {
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      lastErr = err;

      if (!isRetryableError(err) || attempt === maxAttempts) {
        // Non-retryable or last attempt: rethrow
        throw err;
      }

      // Simple linear backoff; we can refine later if needed.
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  // Should not get here, but keep TS/linters happy if you add them later.
  throw lastErr || new Error("Unknown error in getWithRetry");
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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
async function fetchDailySchedule(routeId, tripDateText) {
  const apiKey = requireApiKey();

  // Example URL per Cannon:
  //   Ferries/API/Schedule/rest/schedule/{TripDateText}/{Route}?apiaccesscode=...
  const url =
    `https://www.wsdot.wa.gov/Ferries/API/Schedule/rest/schedule/` +
    `${encodeURIComponent(tripDateText)}/` +
    `${encodeURIComponent(routeId)}?apiaccesscode=${encodeURIComponent(apiKey)}`;

  const res = await getWithRetry(
    url,
    {
      timeout: 8000,
      headers: { Accept: "application/json" },
    },
    2,      // maxAttempts
    500     // backoffMs
  );

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

// ---------------------------------------------------------------------------
// Stage 1b: RouteDetails Fetcher (for route ↔ terminals mapping)
// ---------------------------------------------------------------------------
//
// We will use this to derive:
//   - TerminalID_West / TerminalID_East per RouteID
//   - Any future per-route metadata routedetails exposes.
//
// Shape per WSDOT docs:
//   GET /routedetails/{TripDate}/{RouteID}?apiaccesscode=...
//   or  /routedetails/{TripDate}?apiaccesscode=... for all routes on a date.
//
// For now we just return the raw JSON; dotState/routeConfig/terminalMap will
// decide how to interpret it for Cannon.
// ---------------------------------------------------------------------------
async function fetchRouteDetails(routeId, tripDateText) {
  const apiKey = requireApiKey();

  const url =
    `https://www.wsdot.wa.gov/Ferries/API/Schedule/rest/routedetails/` +
    `${encodeURIComponent(tripDateText)}/` +
    `${encodeURIComponent(routeId)}?apiaccesscode=${encodeURIComponent(apiKey)}`;

  const res = await getWithRetry(
    url,
    {
      timeout: 8000,
      headers: { Accept: "application/json" },
    },
    2,    // maxAttempts
    500   // backoffMs
  );


  return res && typeof res.data !== "undefined" ? res.data : null;
}

// ---------------------------------------------------------------------------
// Vessels API: /vessellocations (Cannon live vessel layer)
// ---------------------------------------------------------------------------

const WSDOT_BASE = "https://www.wsdot.wa.gov/Ferries/API/Vessels/rest";

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

  const res = await getWithRetry(
    url,
    {
      timeout: 8000,
      headers: { Accept: "application/json" },
    },
    2,    // maxAttempts
    500   // backoffMs
  );


  if (!res || !Array.isArray(res.data)) {
    throw new Error("Unexpected vessellocations payload");
  }
  return res.data.map(normalizeVessel).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Terminals API: terminal sailingspace (Cannon capacity pies)
// ---------------------------------------------------------------------------
//
// Raw shape per WSDOT docs (JSON):
//   [
//     {
//       TerminalID,
//       TerminalSubjectID,
//       ...,
//       DepartingSpaces: [
//         {
//           Departure, IsCancelled, VesselID, VesselName, MaxSpaceCount,
//           SpaceForArrivalTerminals: [
//             {
//               TerminalID, TerminalName, VesselID, VesselName,
//               DriveUpSpaceCount, MaxSpaceCount, ...,
//             },
//             ...
//           ]
//         },
//         ...
//       ]
//     },
//     ...
//   ]
//
// For capacity donuts we only care about:
//   - TerminalID (outer key)
//   - For each DepartingSpaces[*].SpaceForArrivalTerminals[*]:
//       - TerminalID
//       - DriveUpSpaceCount
//       - MaxSpaceCount
//
// We keep normalization minimal here and push Cannon’s West/East aggregation
// into dotState, so this function remains a generic client.

async function fetchTerminalSpaces() {
  const apiKey = requireApiKey();
  const url =
    `https://www.wsdot.wa.gov/Ferries/API/Terminals/rest/terminalsailingspace` +
    `?apiaccesscode=${encodeURIComponent(apiKey)}`;

  const res = await getWithRetry(
    url,
    {
      timeout: 8000,
      headers: { Accept: "application/json" },
    },
    2,    // maxAttempts
    500   // backoffMs
  );


  const data = res && res.data;
  if (!Array.isArray(data)) {
    throw new Error("Unexpected terminalsailingspace payload (expected array)");
  }

  // Return raw rows; dotState will apply route/terminal filters and aggregation.
  return data;
}

// Raw schedule fetcher (used by dumpSchedule and for debugging payload shape)
async function fetchDailyScheduleRaw(routeId, tripDateText) {
  const apiKey = requireApiKey();

  const url =
    `https://www.wsdot.wa.gov/Ferries/API/Schedule/rest/schedule/` +
    `${encodeURIComponent(tripDateText)}/` +
    `${encodeURIComponent(routeId)}?apiaccesscode=${encodeURIComponent(apiKey)}`;

  const res = await getWithRetry(
    url,
    {
      timeout: 8000,
      headers: { Accept: "application/json" },
    },
    2,    // maxAttempts
    500   // backoffMs
  );

  return res && typeof res.data !== "undefined" ? res.data : null;
}

module.exports = {
  getNormalizedVessels,
  fetchDailySchedule,
  fetchDailyScheduleRaw,
  fetchRouteDetails,
  fetchTerminalSpaces,
};
