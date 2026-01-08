// backend/dotState.js
// Builds a Dot API response for a given routeId.
//
// - Pulls live vessel data from WSDOT /vessellocations
// - Filters to the selected route (terminalIdWest ↔ terminalIdEast)
// - For each direction, picks a single "lane vessel"
// - Arrival time rule:
//      1) Prefer Eta from API when present
//      2) Else fall back to LeftDock + crossingTimeMinutes
// - If no usable live data for the route, falls back to a synthetic state.

const { getRouteById } = require("./routeConfig");
const {
  getTerminalIdsForRoute,
  resolveTerminalIdsFromRouteDetails,
} = require("./terminalMap");
const {
  getNormalizedVessels,
  fetchDailySchedule,
  fetchDailyScheduleRaw,
  fetchRouteDetails,
  fetchTerminalSpaces,
} = require("./wsdotClient");

// Last-good lane cache (in-memory, per route, per lane).
// We reuse a lane for a finite window when live data disappears,
// marking it stale instead of dropping the lane to "Unknown".
const LAST_GOOD_TTL_MS = 10 * 60 * 1000; // 10 minutes; adjust as needed.
const lastGoodLanesByRoute = Object.create(null);

// Per-route, per-lane dock metadata (Cannon dock fields).
// Tracks when a lane entered dock and whether that time is synthetic.
const dockStateByRoute = Object.create(null);

// Capacity TTL: same 10-minute window as lanes (Cannon stale logic).
const CAPACITY_TTL_MS = LAST_GOOD_TTL_MS;

// Sticky per-vessel max auto capacity.
// Once we learn a vessel's MaxSpaceCount (DepartureMaxSpaceCount), it never changes.
const vesselMaxCapacityById = Object.create(null);

// Last-good capacity per route, per side ("west" | "east").
const lastGoodCapacityByRoute = Object.create(null);

// Simple WSDOT /Date(…)/ parser for Terminals timestamps.
//
// Example: "/Date(1763623116000-0800)/"
function parseWsdotDateForTerminals(raw) {
  if (!raw) return null;
  const m = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(String(raw));
  if (!m) return null;
  const ms = parseInt(m[1], 10);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms);
}

function getStickyVesselMax(vesselId, observedMax) {
  if (vesselId == null) return null;
  const key = String(vesselId);

  if (Object.hasOwn(vesselMaxCapacityById, key)) {
    return vesselMaxCapacityById[key];
  }

  if (typeof observedMax === "number" && Number.isFinite(observedMax) && observedMax > 0) {
    vesselMaxCapacityById[key] = observedMax;
    return observedMax;
  }

  return null;
}

function getLastGoodCapacity(routeId, side, nowMs) {
  const routeKey = String(routeId);
  const entry = lastGoodCapacityByRoute[routeKey];
  if (!entry) return null;

  const sideEntry = entry[side];
  if (!sideEntry) return null;

  if ((nowMs - sideEntry.tMs) > CAPACITY_TTL_MS) {
    return null;
  }
  return sideEntry.data;
}

function setLastGoodCapacity(routeId, side, data, nowMs) {
  const routeKey = String(routeId);
  if (!lastGoodCapacityByRoute[routeKey]) {
    lastGoodCapacityByRoute[routeKey] = {};
  }
  // store shallow copy so callers cannot mutate cache.
  lastGoodCapacityByRoute[routeKey][side] = {
    data: { ...data },
    tMs: nowMs,
  };
}

function serviceDayKeyPacific(date) {
  const d = new Date(date);
  if (d.getHours() < 3) d.setDate(d.getDate() - 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatPacificYmd(date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date); // "YYYY-MM-DD"
}

function deriveCapacityForSide(options) {
  const {
    routeId,
    side,                 // "west" | "east"
    terminalIdSide,       // this side's terminalId
    terminalIdOther,      // opposite side's terminalId
    scheduledLane,        // lane object from deriveLaneVesselsForRoute, may be null
    terminalsPayload,     // array from fetchTerminalSpaces()
    now,
  } = options;

  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  let usedFallback = false;

  if (!Array.isArray(terminalsPayload) || !terminalIdSide || !terminalIdOther) {
    // nothing to work with -> last-good or null
    const lastGood = getLastGoodCapacity(routeId, side, nowMs);
    if (lastGood) {
      return {
        data: { ...lastGood, isStale: true },
        usedFallback: true,
      };
    }
    return { data: null, usedFallback: true };
  }

  const sideTermIdNum = Number(terminalIdSide);
  const otherTermIdNum = Number(terminalIdOther);

  const scheduledVesselId =
    scheduledLane && scheduledLane.vesselId != null
      ? Number(scheduledLane.vesselId)
      : null;

  // Flatten candidates: departures from this terminal that serve the opposite terminal.
  const candidates = [];

  for (const terminalRow of terminalsPayload) {
    if (!terminalRow || Number(terminalRow.TerminalID) !== sideTermIdNum) continue;

    const departingSpaces = Array.isArray(terminalRow.DepartingSpaces)
      ? terminalRow.DepartingSpaces
      : [];

    for (const dep of departingSpaces) {
      if (!dep) continue;

      const arrivalList = Array.isArray(dep.SpaceForArrivalTerminals)
        ? dep.SpaceForArrivalTerminals
        : [];

      for (const arr of arrivalList) {
        if (!arr) continue;
        if (Number(arr.TerminalID) !== otherTermIdNum) continue;

        const depDate =
          parseWsdotDateForTerminals(dep.Departure) ||
          (dep.Departure ? new Date(dep.Departure) : null);

        const depMs = depDate && Number.isFinite(depDate.getTime())
          ? depDate.getTime()
          : null;

        const vesselId = dep.VesselID != null ? Number(dep.VesselID) : null;
        const vesselName = dep.VesselName || arr.VesselName || null;

        const rawMax =
          typeof dep.MaxSpaceCount === "number"
            ? dep.MaxSpaceCount
            : (typeof arr.MaxSpaceCount === "number" ? arr.MaxSpaceCount : null);

        const driveUp =
          typeof arr.DriveUpSpaceCount === "number"
            ? arr.DriveUpSpaceCount
            : null;

        candidates.push({
          depMs,
          vesselId,
          vesselName,
          rawMax,
          driveUp,
        });
      }
    }
  }

  const futureCandidates = candidates
    .filter(c => c.depMs != null && c.depMs >= nowMs)
    .sort((a, b) => a.depMs - b.depMs);

  let chosen = null;

  // Helper: finite drive-up value
  const hasDriveUp = (c) =>
    typeof c.driveUp === "number" && Number.isFinite(c.driveUp);

  // Step 1: schedule-matched vessel, earliest future departure WITH real drive-up
  if (scheduledVesselId != null) {
    const schedMatches = futureCandidates.filter(
      c => c.vesselId != null && Number(c.vesselId) === scheduledVesselId
    );
    if (schedMatches.length > 0) {
      const schedWithDriveUp = schedMatches.filter(hasDriveUp);
      if (schedWithDriveUp.length > 0) {
        chosen = schedWithDriveUp[0];
      }
    }
  }

  // Step 2: fallback to next departure with real drive-up data
  if (!chosen && futureCandidates.length > 0) {
    const withDriveUp = futureCandidates.filter(hasDriveUp);
    if (withDriveUp.length > 0) {
      chosen = withDriveUp[0];
      // If we had a scheduled vessel, this is a logical fallback.
      if (scheduledVesselId != null) {
        usedFallback = true;
      }
    }
  }

  const lastGood = getLastGoodCapacity(routeId, side, nowMs);

  // If we still have no candidate, fall back to last-good or null
  if (!chosen) {
    if (lastGood) {
      return {
        data: { ...lastGood, isStale: true },
        usedFallback: true,
      };
    }
    return { data: null, usedFallback: true };
  }

  const maxAuto = getStickyVesselMax(chosen.vesselId, chosen.rawMax);

  let availAuto = chosen.driveUp;
  let isStale = false;

  if (availAuto == null || !Number.isFinite(availAuto)) {
    if (lastGood && typeof lastGood.availAuto === "number") {
      availAuto = lastGood.availAuto;
      isStale = true;
      usedFallback = true;
    } else {
      // No usable capacity; do not fabricate 0.
      return {
        data: null,
        usedFallback: true,
      };
    }
  }

  const data = {
    terminalId: terminalIdSide,
    vesselId: chosen.vesselId,
    vesselName: chosen.vesselName,
    maxAuto: maxAuto != null ? maxAuto : null,
    availAuto,
    lastUpdated: nowIso,
    isStale,
  };

  setLastGoodCapacity(routeId, side, data, nowMs);

  return { data, usedFallback };
}

function updateDockMetaForLane(routeId, laneKey, lane, now) {
  // If this lane does not exist (missing/stale), do not attempt to
  // compute dock metadata. Clear any cached dock state for this lane
  // and return null.
  if (!lane) {
    if (dockStateByRoute[routeId]) {
      delete dockStateByRoute[routeId][laneKey];
    }
    return null;
  }

  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  if (!dockStateByRoute[routeId]) {
    dockStateByRoute[routeId] = {};
  }

  const routeDockState = dockStateByRoute[routeId];
  const prev = routeDockState[laneKey] || null;
  const hadPrev = !!prev;
  const prevAtDock = prev ? !!prev.atDock : false;
  const prevDockStartTimeIso = prev ? prev.dockStartTime : null;
  const prevDockStartIsSynthetic = prev ? !!prev.dockStartIsSynthetic : false;

  let dockStartTime = null;
  let dockStartIsSynthetic = false;
  let dockArcFraction = null;

  if (lane.atDock) {
    // Lane is at dock this poll.

    if (hadPrev && prevAtDock && prevDockStartTimeIso) {
      // Stayed at dock; keep previous start time and synthetic flag.
      dockStartTime = prevDockStartTimeIso;
      dockStartIsSynthetic = prevDockStartIsSynthetic;
    } else if (hadPrev && !prevAtDock) {
      // Real transition into dock this poll (FALSE -> TRUE).
      dockStartTime = nowIso;
      dockStartIsSynthetic = false;
    } else {
      // Boot or unknown-history case: at dock but no usable previous metadata.
      // Use boot fallback: dockStartTime_boot = ScheduledDeparture - 25 minutes,
      // clamped to "now" if that lands in the future or is invalid.
      const schedIso = lane.scheduledDeparture;
      if (schedIso) {
        const schedMs = Date.parse(schedIso);
        if (isFinite(schedMs)) {
          let dockStartMs = schedMs - 25 * 60 * 1000;
          if (dockStartMs > nowMs) {
            dockStartMs = nowMs;
          }
          dockStartTime = new Date(dockStartMs).toISOString();
          dockStartIsSynthetic = true;
        } else {
          dockStartTime = nowIso;
          dockStartIsSynthetic = true;
        }
      } else {
        dockStartTime = nowIso;
        dockStartIsSynthetic = true;
      }
    }

    // Compute dock arc fraction: minutes at dock, capped at 60 minutes.
    const dockStartMs = Date.parse(dockStartTime);
    if (isFinite(dockStartMs)) {
      const elapsedMs = nowMs - dockStartMs;
      if (elapsedMs <= 0) {
        dockArcFraction = 0;
      } else {
        const frac = elapsedMs / (60 * 60 * 1000); // 60 minutes
        dockArcFraction = frac >= 1 ? 1 : frac;
      }
    }
  } else {
    // Not at dock → clear dock metadata.
    dockStartTime = null;
    dockStartIsSynthetic = false;
    dockArcFraction = null;
  }

  // Persist for next poll.
  routeDockState[laneKey] = {
    atDock: lane.atDock,
    dockStartTime,
    dockStartIsSynthetic,
  };

  return {
    ...lane,
    dockStartTime,
    dockStartIsSynthetic,
    dockArcFraction,
    lastUpdatedVessels: lane.lastUpdatedVessels || nowIso,
  };
}
function computeEligibleVessels(schedule, now) {
  const nowMs = now.getTime();
  const sdNow = serviceDayKeyPacific(now);
  const eligible = new Set();

  if (!schedule) return eligible;

  const all = [
    ...(schedule.west || []),
    ...(schedule.east || [])
  ];

  for (const s of all) {
    if (!s || !s.departureTimeIso || !s.vesselName) continue;

    const depMs = Date.parse(s.departureTimeIso);
    if (!Number.isFinite(depMs)) continue;
    if (depMs < nowMs) continue;
    if (serviceDayKeyPacific(depMs) !== sdNow) continue;

    eligible.add(s.vesselName);
  }

  return eligible;
}

// laneKey: "upper" | "lower"
function getLastGoodLane(routeId, laneKey, nowMs) {
  const entry = lastGoodLanesByRoute[routeId];
  if (!entry) return null;
  const laneEntry = entry[laneKey];
  if (!laneEntry) return null;

  if ((nowMs - laneEntry.tMs) > LAST_GOOD_TTL_MS) {
    return null;
  }
  return laneEntry.lane;
}

function setLastGoodLane(routeId, laneKey, lane, nowMs) {
  if (!lastGoodLanesByRoute[routeId]) {
    lastGoodLanesByRoute[routeId] = {};
  }
  // Store a shallow copy so callers can't mutate the cached instance.
  lastGoodLanesByRoute[routeId][laneKey] = {
    lane: { ...lane },
    tMs: nowMs,
  };
}

// ---- Core helpers ----

function deriveLabel(name) {
  if (!name) return "";
  return String(name).toUpperCase();
}

// Prefer raw ETA; only use fallback when raw ETA missing.
function pickArrivalTime(rawEtaIso, leftDockIso, crossingMinutes) {
  if (rawEtaIso) {
    return rawEtaIso;
  }
  if (!leftDockIso || !crossingMinutes || crossingMinutes <= 0) {
    return null;
  }
  const leftMs = Date.parse(leftDockIso);
  if (!isFinite(leftMs)) return null;
  const crossingMs = crossingMinutes * 60 * 1000;
  const etaMs = leftMs + crossingMs;
  return new Date(etaMs).toISOString();
}

// Compute [0,1] position.
function computeDotPosition(leftDockIso, etaIso, now) {
  if (!leftDockIso || !etaIso) {
    return 0;
  }
  const leftMs = Date.parse(leftDockIso);
  const etaMs = Date.parse(etaIso);
  const nowMs = now.getTime();

  if (!isFinite(leftMs) || !isFinite(etaMs) || etaMs <= leftMs) {
    return 0;
  }

  const frac = (nowMs - leftMs) / (etaMs - leftMs);

  if (frac <= 0) return 0;
  if (frac >= 1) return 1;
  return frac;
}

// This helper is used for "liveTerminals" routes (triangle legs).
// It does NOT use schedule_by_route at all. Instead, it picks a vessel
// for each lane purely from live, normalized vessellocations data,
// based on the departure/arrival terminal IDs.
function pickLaneVesselsFromLive(route, terminalIdWest, terminalIdEast, rawList) {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    return { upperRaw: null, lowerRaw: null };
  }

  const norm = rawList.filter(Boolean);

  const westToEast = norm
    .filter(
      (v) =>
        Number(v.departingId) === Number(terminalIdWest) &&
        Number(v.arrivingId) === Number(terminalIdEast)
    )
    .sort((a, b) => {
      const posDiff =
        (a.vesselPositionNumber || 0) - (b.vesselPositionNumber || 0);
      if (posDiff !== 0) return posDiff;
      const aDep = a.scheduledDepartureIso || "";
      const bDep = b.scheduledDepartureIso || "";
      return aDep.localeCompare(bDep);
    });

  const eastToWest = norm
    .filter(
      (v) =>
        Number(v.departingId) === Number(terminalIdEast) &&
        Number(v.arrivingId) === Number(terminalIdWest)
    )
    .sort((a, b) => {
      const posDiff =
        (a.vesselPositionNumber || 0) - (b.vesselPositionNumber || 0);
      if (posDiff !== 0) return posDiff;
      const aDep = a.scheduledDepartureIso || "";
      const bDep = b.scheduledDepartureIso || "";
      return aDep.localeCompare(bDep);
    });

  return {
    // UPPER lane = west → east
    upperRaw: westToEast[0] || null,
    // LOWER lane = east → west
    lowerRaw: eastToWest[0] || null,
  };
}

// ---------------------------------------------------------------------------
// LaneVessels derivation (Cannon Section 3)
//
// Computes which vessel is assigned to the UPPER and LOWER slots for today,
// based on the daily schedule and TerminalID_West.
//
// This does NOT touch live vessellocations data. It only looks at the schedule.
// ---------------------------------------------------------------------------

async function deriveLaneVesselsForRoute(route, terminalIdWest, now) {
  // Trip date in YYYY-MM-DD form based on "now".
  const tripDateText = formatPacificYmd(now);

  let rows;
  try {
    rows = await fetchDailySchedule(route.routeId, tripDateText);
  } catch (err) {
    console.error(
      `Error fetching schedule for route ${route.routeId}:`,
      err.message || err
    );
    return {
      upper: null,
      lower: null,
      scheduleError: true,
    };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      upper: null,
      lower: null,
      scheduleError: true,
    };
  }

  // Filter to this route + TerminalID_West as defined in Cannon.
  const westRows = rows.filter(
    (r) =>
      Number(r.routeId) === Number(route.routeId) &&
      Number(r.departingTerminalId) === Number(terminalIdWest)
  );

  if (westRows.length === 0) {
    return {
      upper: null,
      lower: null,
      scheduleError: false,
    };
  }

  // Find the rows for VesselPositionNumber 1 and 2, if present.
  let upperRow =
    westRows.find((r) => Number(r.vesselPositionNumber) === 1) || null;
  let lowerRow =
    westRows.find((r) => Number(r.vesselPositionNumber) === 2) || null;

  // Normalize shape for the caller.
  const upper =
    upperRow && upperRow.vesselId != null
      ? {
          vesselPositionNumber: 1,
          vesselId: upperRow.vesselId,
          vesselName: upperRow.vesselName || null,
        }
      : null;

  const lower =
    lowerRow && lowerRow.vesselId != null
      ? {
          vesselPositionNumber: 2,
          vesselId: lowerRow.vesselId,
          vesselName: lowerRow.vesselName || null,
        }
      : null;

  return {
    upper,
    lower,
    scheduleError: false,
  };
}

// For stale lanes: if we've passed the ETA, treat the vessel as at dock.
// This avoids showing "UNDERWAY" with an ETA in the past when WSDOT has
// dropped the vessel record and we're using last-good data.
function snapStaleLaneToDockIfArrived(lane, now) {
  if (!lane) return lane;
  if (!lane.isStale) return lane;
  if (!lane.eta) return lane;

  const etaMs = Date.parse(lane.eta);
  if (!isFinite(etaMs)) return lane;

  const nowMs = now.getTime();
  if (nowMs < etaMs) {
    // Not yet at ETA; keep stale underway state as-is.
    return lane;
  }

  // We've passed ETA; force arrival at dock visually.
  return {
    ...lane,
    atDock: true,
    phase: "AT_DOCK",
    dotPosition: 1,
  };
}

// When live terminals are missing for an at-dock vessel, use the scheduled lane's
// departure terminal to decide which side the boat is tied up on.
function deriveDirectionWithSchedule(raw, scheduledLane, terminalIdWest, terminalIdEast, defaultDirection) {
  // First, let the existing logic try to use live Departing/Arriving IDs.
  const base = deriveDirectionAndTerminals(raw, terminalIdWest, terminalIdEast, defaultDirection);

  // If we had clear live terminal IDs, do not override with schedule.
  const hasLiveTerminals =
    raw && raw.departingId != null && raw.arrivingId != null;
  if (hasLiveTerminals) {
    return base;
  }

  // We only care about the special case: at dock, no live terminals, but we
  // know which terminal the *next scheduled departure* uses for this vessel.
  if (!raw || !raw.atDock || !scheduledLane || scheduledLane.vesselId == null) {
    return base;
  }

  if (Number(scheduledLane.vesselId) !== Number(raw.vesselId)) {
    return base;
  }

  const schedDep = scheduledLane.departureTerminalId != null
    ? Number(scheduledLane.departureTerminalId)
    : null;

  if (schedDep == null) {
    return base;
  }

  if (schedDep === Number(terminalIdWest)) {
    return {
      direction: "WEST_TO_EAST",
      departureTerminalId: terminalIdWest,
      arrivalTerminalId: terminalIdEast,
    };
  }

  if (schedDep === Number(terminalIdEast)) {
    return {
      direction: "EAST_TO_WEST",
      departureTerminalId: terminalIdEast,
      arrivalTerminalId: terminalIdWest,
    };
  }

  return base;
}

function deriveDirectionAndTerminals(raw, terminalIdWest, terminalIdEast, defaultDirection) {
  // If we have clear live terminals, prefer them.
  if (raw && raw.departingId != null && raw.arrivingId != null) {
    const dep = Number(raw.departingId);
    const arr = Number(raw.arrivingId);

    if (dep === Number(terminalIdWest) && arr === Number(terminalIdEast)) {
      return {
        direction: "WEST_TO_EAST",
        departureTerminalId: terminalIdWest,
        arrivalTerminalId: terminalIdEast,
      };
    }

    if (dep === Number(terminalIdEast) && arr === Number(terminalIdWest)) {
      return {
        direction: "EAST_TO_WEST",
        departureTerminalId: terminalIdEast,
        arrivalTerminalId: terminalIdWest,
      };
    }
  }

  // Fallback: use the lane's expected default direction per Cannon.
  if (defaultDirection === "WEST_TO_EAST") {
    return {
      direction: "WEST_TO_EAST",
      departureTerminalId: terminalIdWest,
      arrivalTerminalId: terminalIdEast,
    };
  }

  if (defaultDirection === "EAST_TO_WEST") {
    return {
      direction: "EAST_TO_WEST",
      departureTerminalId: terminalIdEast,
      arrivalTerminalId: terminalIdWest,
    };
  }

  // Extremely degraded case.
  return {
    direction: "UNKNOWN",
    departureTerminalId: null,
    arrivalTerminalId: null,
  };
}

function buildLaneFromVessel(raw, opts) {
  const {
    laneId,
    positionNumber,
    direction,
    departureTerminalId,
    arrivalTerminalId,
    route,
    now,
  } = opts;

  const nowIso = now.toISOString();
  const crossingMinutes = route.crossingTimeMinutes;

  if (!raw) {
    // No live vessel found for this lane → degraded but valid lane.
    return {
      laneId,
      vesselPositionNumber: positionNumber,
      vesselId: null,
      vesselName: "Unknown",
      atDock: true,
      direction,
      departureTerminalId,
      arrivalTerminalId,
      scheduledDeparture: null,
      leftDock: null,
      eta: null,
      phase: "UNKNOWN",
      dotPosition: 0,
      currentArrivalTime: null,
      dockStartTime: null,
      dockStartIsSynthetic: true,
      dockArcFraction: null,
      lastUpdatedVessels: nowIso,
      isStale: false,
    };
  }

  // Be defensive about where the name might live.
  // This covers both normalized fields (vesselName) and any raw WSDOT casing.
  const safeName =
    raw.vesselName ||
    raw.VesselName ||
    raw.name ||
    raw.Name ||
    null;

  const leftDockIso = raw.leftDockIso || raw.scheduledDepartureIso || null;
  const etaIso = pickArrivalTime(raw.etaIso, leftDockIso, crossingMinutes);
  let dotPos = computeDotPosition(leftDockIso, etaIso, now);

  const atDock = raw.atDock;

  let phase = "UNKNOWN";
  if (atDock) {
    phase = "AT_DOCK";
    // When lane is at dock, dot belongs at the dock, not partway along the run.
    dotPos = 0;
  } else if (etaIso) {
    phase = "UNDERWAY";
  }

  return {
    laneId,
    vesselPositionNumber: positionNumber,
    vesselId: raw.vesselId,
    vesselName: safeName || "Unknown vessel",
    atDock,
    direction,
    departureTerminalId,
    arrivalTerminalId,
    scheduledDeparture: raw.scheduledDepartureIso,
    leftDock: leftDockIso,
    eta: etaIso,
    phase,
    dotPosition: dotPos,
    currentArrivalTime: etaIso || raw.scheduledDepartureIso || null,
    dockStartTime: atDock ? (raw.leftDockIso || raw.scheduledDepartureIso) : null,
    dockStartIsSynthetic: false,
    dockArcFraction: null,
    lastUpdatedVessels: nowIso,
    isStale: false,
  };
}

// ---- Synthetic fallback (no live data / API failure) ----
function buildSyntheticState(route, terminalIdWest, terminalIdEast, now) {
  const nowIso = now.toISOString();

  return {
    route: {
      ...route,
      labelWest: deriveLabel(route.terminalNameWest),
      labelEast: deriveLabel(route.terminalNameEast),
    },

    lanes: {
      upper: null,
      lower: null,
    },

    capacity: null,

    meta: {
      synthetic: true,
      reason: "no_live_or_scheduled_vessels",
      lastUpdated: nowIso,
    },
  };
}


// ---- Main entry point ----
async function deriveNextDeparturesForLeg(route, terminalIdWest, terminalIdEast, now) {
  if (terminalIdWest == null || terminalIdEast == null) {
    return null;
  }

  const tripDateText = formatPacificYmd(now);
  let data;
  try {
    data = await fetchDailyScheduleRaw(route.routeId, tripDateText);
  } catch (err) {
    console.error(
      `Error fetching raw schedule for route ${route.routeId}:`,
      err.message || err
    );
    return null;
  }

  if (!data || typeof data !== "object" || !Array.isArray(data.TerminalCombos)) {
    return null;
  }

  const combos = data.TerminalCombos;
  const nowMs = now.getTime();

  function findNextForDirection(departId, arriveId) {
    let best = null;

    for (const combo of combos) {
      if (!combo) continue;

      const depId = combo.DepartingTerminalID ?? null;
      const arrId = combo.ArrivingTerminalID ?? null;

      if (Number(depId) !== Number(departId) || Number(arrId) !== Number(arriveId)) {
        continue;
      }

      const times = Array.isArray(combo.Times) ? combo.Times : [];
      for (const t of times) {
        if (!t) continue;

        const d = parseWsdotDateForTerminals(t.DepartingTime);
        if (!d) continue;

        const dMs = d.getTime();
        if (dMs <= nowMs) continue;

        if (!best || dMs < best.departureMs) {
          best = {
            departureMs: dMs,
            departureTimeIso: d.toISOString(),
            vesselName: t.VesselName ?? null,
            vesselId: t.VesselID ?? null,
          };
        }
      }
    }

    return best;
  }

  const west = findNextForDirection(terminalIdWest, terminalIdEast);
  const east = findNextForDirection(terminalIdEast, terminalIdWest);

  if (!west && !east) {
    return null;
  }

  function clean(entry) {
    if (!entry) return null;
    return {
      departureTimeIso: entry.departureTimeIso,
      vesselName: entry.vesselName,
      vesselId: entry.vesselId,
    };
  }

  return {
    west: clean(west),
    east: clean(east),
  };
}

async function buildDotState(routeId) {
  const route = getRouteById(routeId);
  if (!route) {
    return null;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const labelWest = deriveLabel(route.terminalNameWest);
  const labelEast = deriveLabel(route.terminalNameEast);

  const laneStrategy = route.laneStrategy || "schedule";
  const hasCapacity = route.hasCapacity !== false;

  let nextDepartures = null;

  let { terminalIdWest, terminalIdEast } = getTerminalIdsForRoute(route);

  try {
    const tripDateText =formatPacificYmd(now);

    const sched = await fetchDailyScheduleRaw(route.routeId, tripDateText);

    if (sched && Array.isArray(sched.TerminalCombos)) {
      const combos = sched.TerminalCombos;

      const nameWest = route.terminalNameWest
        ? String(route.terminalNameWest).trim().toLowerCase()
        : null;
      const nameEast = route.terminalNameEast
        ? String(route.terminalNameEast).trim().toLowerCase()
        : null;

      let westId = terminalIdWest;
      let eastId = terminalIdEast;

      for (const combo of combos) {
        if (!combo) continue;

        const depNameRaw = combo.DepartingTerminalName;
        const depId = combo.DepartingTerminalID;

        if (depNameRaw == null || depId == null) continue;

        const depName = String(depNameRaw).trim().toLowerCase();

        // Match WEST / EAST by DepartingTerminalName, as you specified.
        if (nameWest && depName === nameWest && westId == null) {
          westId = Number(depId);
        }
        if (nameEast && depName === nameEast && eastId == null) {
          eastId = Number(depId);
        }

        if (westId != null && eastId != null) {
          break;
        }
      }

      if (westId != null) {
        terminalIdWest = westId;
      }
      if (eastId != null) {
        terminalIdEast = eastId;
      }
    }
  } catch (_err) {
    // On any error, leave terminalIdWest/East as-is (name-based or null).
  }

  // ---- Capacity placeholders (to be filled below) ----
  let capacity = null;
  let capacityLastUpdatedIso = null;
  let capacityStale = true;
  let capacityUsedFallback = false;

  let terminalsPayload = null;
  try {
    terminalsPayload = await fetchTerminalSpaces();
  } catch (err) {
    console.error("Error fetching WSDOT terminalsailingspace:", err.message || err);
    terminalsPayload = null;
    capacityStale = true;
  }

  // -------------------------------------------------------------------------
  // TerminalID fallback via terminalsailingspace (Cannon Section 2)
  //
  // If, after name map + schedule-derived mapping, either terminalIdWest or
  // terminalIdEast is still null, try to resolve IDs from the terminals
  // payload by matching TerminalName case-insensitively.
  //
  // This matches the Cannon rule:
  //   "Input: TerminalNameWest/East; Lookup: first row where TerminalName
  //    matches (case-insensitive); Output: TerminalID."
  // -------------------------------------------------------------------------
  if ((terminalIdWest == null || terminalIdEast == null) && Array.isArray(terminalsPayload)) {
    const nameWest = route.terminalNameWest
      ? String(route.terminalNameWest).trim().toLowerCase()
      : null;
    const nameEast = route.terminalNameEast
      ? String(route.terminalNameEast).trim().toLowerCase()
      : null;

    for (const row of terminalsPayload) {
      if (!row) continue;

      const tNameRaw = row.TerminalName;
      const tId = row.TerminalID;

      if (tNameRaw == null || tId == null) continue;

      const tName = String(tNameRaw).trim().toLowerCase();

      if (terminalIdWest == null && nameWest && tName === nameWest) {
        terminalIdWest = Number(tId);
      }
      if (terminalIdEast == null && nameEast && tName === nameEast) {
        terminalIdEast = Number(tId);
      }

      if (terminalIdWest != null && terminalIdEast != null) {
        break;
      }
    }
  }

  // Live vessels (may be empty or error)
  let liveVessels = [];
  let usedFallback = false;

  try {
    liveVessels = await getNormalizedVessels();
  } catch (err) {
    console.error("Error fetching WSDOT vessellocations:", err.message || err);
    usedFallback = true;
    liveVessels = [];
  }

// NEW: Lane-vessel resolution (Cannon Section 3)
// Instead of choosing lanes by direction, we map lanes to the vessels that
// belong in slot 1 (upper) and slot 2 (lower), based on today's schedule
// or directly from live terminals for special routes.
// ---------------------------------------------------------------------------
let scheduledUpper = null;
let scheduledLower = null;
let scheduleError = false;

let upperRaw = null;
let lowerRaw = null;

if (laneStrategy === "liveTerminals") {
  const picked = pickLaneVesselsFromLive(
    route,
    terminalIdWest,
    terminalIdEast,
    liveVessels
  );

  upperRaw = picked.upperRaw;
  lowerRaw = picked.lowerRaw;

  // For liveTerminals routes we do not derive capacity from terminalsailingspace.
  // If we cannot assign a live vessel in either direction, we leave both lanes
  // null and let the frontend treat the route as having no active vessels,
  // instead of fabricating synthetic "Unknown" vessels.
  // (upperRaw and lowerRaw will remain null here when nothing is live.)
  } else {

    const lanePlan = await deriveLaneVesselsForRoute(route, terminalIdWest, now);
    scheduledUpper = lanePlan.upper;
    scheduledLower = lanePlan.lower;
    scheduleError = lanePlan.scheduleError;

    // If schedule is unusable, *then* synthetic fallback is appropriate.
    if (scheduleError || (!scheduledUpper && !scheduledLower)) {
      return buildSyntheticState(route, terminalIdWest, terminalIdEast, now);
    }

    // ---- Capacity for west/east terminals (Cannon capacity pies, hybrid rule) ----
    if (hasCapacity && terminalsPayload && Array.isArray(terminalsPayload)) {
      // Choose the scheduled lane for each side based on departure terminal,
      // not lane position (upper/lower).
      let scheduledWestLane = null;
      let scheduledEastLane = null;

      if (scheduledUpper && scheduledUpper.departureTerminalId === terminalIdWest) {
        scheduledWestLane = scheduledUpper;
      } else if (scheduledLower && scheduledLower.departureTerminalId === terminalIdWest) {
        scheduledWestLane = scheduledLower;
      }

      if (scheduledUpper && scheduledUpper.departureTerminalId === terminalIdEast) {
        scheduledEastLane = scheduledUpper;
      } else if (scheduledLower && scheduledLower.departureTerminalId === terminalIdEast) {
        scheduledEastLane = scheduledLower;
      }

      const westResult = deriveCapacityForSide({
        routeId: route.routeId,
        side: "west",
        terminalIdSide: terminalIdWest,
        terminalIdOther: terminalIdEast,
        scheduledLane: scheduledWestLane,
        terminalsPayload,
        now,
      });

      const eastResult = deriveCapacityForSide({
        routeId: route.routeId,
        side: "east",
        terminalIdSide: terminalIdEast,
        terminalIdOther: terminalIdWest,
        scheduledLane: scheduledEastLane,
        terminalsPayload,
        now,
      });

      const west = westResult.data;
      const east = eastResult.data;

      capacityUsedFallback = !!(westResult.usedFallback || eastResult.usedFallback);

      if (west || east) {
        capacity = {
          westMaxAuto: west && typeof west.maxAuto === "number" ? west.maxAuto : null,
          westAvailAuto: west && typeof west.availAuto === "number" ? west.availAuto : null,
          westVesselId: west ? west.vesselId : null,
          westVesselName: west ? west.vesselName : null,

          eastMaxAuto: east && typeof east.maxAuto === "number" ? east.maxAuto : null,
          eastAvailAuto: east && typeof east.availAuto === "number" ? east.availAuto : null,
          eastVesselId: east ? east.vesselId : null,
          eastVesselName: east ? east.vesselName : null,
        };

        const timestamps = [];
        if (west && west.lastUpdated) timestamps.push(west.lastUpdated);
        if (east && east.lastUpdated) timestamps.push(east.lastUpdated);

        capacityLastUpdatedIso =
          timestamps.length > 0 ? timestamps.sort().slice(-1)[0] : null;
        capacityStale = !!(
          (west && west.isStale) ||
          (east && east.isStale) ||
          capacityUsedFallback
        );
      } else {
        capacity = null;
        capacityLastUpdatedIso = null;
        capacityStale = true;
      }
    }

    // Load live vessels indexed by VesselID (may be empty)
    const byId = new Map();
    if (Array.isArray(liveVessels)) {
      for (const v of liveVessels) {
        if (v && v.vesselId != null) byId.set(v.vesselId, v);
      }
    }

    // Determine live raw vessels for each lane by matching scheduled vesselIds
    if (scheduledUpper && scheduledUpper.vesselId != null) {
      upperRaw = byId.get(scheduledUpper.vesselId) || null;
    }

    if (scheduledLower && scheduledLower.vesselId != null) {
      lowerRaw = byId.get(scheduledLower.vesselId) || null;
    }

    // If schedule assigned no vessels at all, then synthetic fallback is appropriate.
    // IMPORTANT: do NOT fall back just because live vessellocations is missing.
    const hasScheduled =
      (scheduledUpper && scheduledUpper.vesselId != null) ||
      (scheduledLower && scheduledLower.vesselId != null);

    if (!hasScheduled) {
      return buildSyntheticState(route, terminalIdWest, terminalIdEast, now);
    }

  }

  // ---- Build lanes with last-good caching ----
  let upperLane;
  let lowerLane;
  let upperSource = "missing"; // "live" | "stale" | "missing"
  let lowerSource = "missing";

  // ---------------------------------------------------------------------
  // Schedule-only lane construction fallback
  // If schedule assigns a vessel but live vessellocations is missing,
  // build a stale at-dock lane so direction can be inferred correctly.
  // ---------------------------------------------------------------------
  if (laneStrategy === "schedule") {
    if (!upperRaw && scheduledUpper && scheduledUpper.vesselId != null) {
      upperRaw = {
        vesselId: scheduledUpper.vesselId,
        vesselName: scheduledUpper.vesselName,
        atDock: true,
        departingId: null,
        arrivingId: null,
        leftDockIso: null,
        etaIso: null,
        isSynthetic: true,
      };
    }

    if (!lowerRaw && scheduledLower && scheduledLower.vesselId != null) {
      lowerRaw = {
        vesselId: scheduledLower.vesselId,
        vesselName: scheduledLower.vesselName,
        atDock: true,
        departingId: null,
        arrivingId: null,
        leftDockIso: null,
        etaIso: null,
        isSynthetic: true,
      };
    }
  }

  // UPPER lane: slot 1 vessel, direction from live terminals when available,
  // otherwise use schedule to choose dock side when at dock.
  if (upperRaw) {
    const upperDirMeta = deriveDirectionWithSchedule(
      upperRaw,
      scheduledUpper,
      terminalIdWest,
      terminalIdEast,
      "WEST_TO_EAST" // default expectation for upper lane
    );

    upperLane = buildLaneFromVessel(upperRaw, {
      laneId: "UPPER",
      positionNumber: 1,
      direction: upperDirMeta.direction,
      departureTerminalId: upperDirMeta.departureTerminalId,
      arrivalTerminalId: upperDirMeta.arrivalTerminalId,
      route,
      now,
    });
    upperSource = "live";
    setLastGoodLane(route.routeId, "upper", upperLane, nowMs);
    } else {
      const cachedUpper = getLastGoodLane(route.routeId, "upper", nowMs);
      if (cachedUpper) {
        upperLane = {
          ...cachedUpper,
          lastUpdatedVessels: nowIso,
          isStale: true,
        };
        upperSource = "stale";
      } else {
        // No live or cached data: remove the lane instead of fabricating a bogus one.
        lowerLane = null;
        lowerSource = "missing";
      }
    }

    // --------------------
    // UPPER lane (slot 1)
    // --------------------
    if (upperRaw) {
      const upperDirMeta = deriveDirectionWithSchedule(
        upperRaw,
        scheduledUpper,
        terminalIdWest,
        terminalIdEast,
        "WEST_TO_EAST"
      );

      upperLane = buildLaneFromVessel(upperRaw, {
        laneId: "UPPER",
        positionNumber: 1,
        direction: upperDirMeta.direction,
        departureTerminalId: upperDirMeta.departureTerminalId,
        arrivalTerminalId: upperDirMeta.arrivalTerminalId,
        route,
        now,
      });

      upperSource = "live";
    }

    // >>> INSERT HERE <<<
    if (upperLane && upperRaw && upperRaw.isSynthetic) {
      upperLane.isStale = true;
    }

      // LOWER lane: slot 2 vessel, direction from live terminals when available,
      // otherwise use schedule to choose dock side when at dock.
      if (lowerRaw) {
        const lowerDirMeta = deriveDirectionWithSchedule(
          lowerRaw,
          scheduledLower,
          terminalIdWest,
          terminalIdEast,
          "EAST_TO_WEST" // default expectation for lower lane
        );

    lowerLane = buildLaneFromVessel(lowerRaw, {
      laneId: "LOWER",
      positionNumber: 2,
      direction: lowerDirMeta.direction,
      departureTerminalId: lowerDirMeta.departureTerminalId,
      arrivalTerminalId: lowerDirMeta.arrivalTerminalId,
      route,
      now,
    });
    lowerSource = "live";
    setLastGoodLane(route.routeId, "lower", lowerLane, nowMs);
  } else {

    const cachedLower = getLastGoodLane(route.routeId, "lower", nowMs);
    if (cachedLower) {
      lowerLane = {
        ...cachedLower,
        lastUpdatedVessels: nowIso,
        isStale: true,
      };
      lowerSource = "stale";
    } else {
      lowerLane = buildLaneFromVessel(null, {
        laneId: "LOWER",
        positionNumber: 2,
        direction: "EAST_TO_WEST",
        departureTerminalId: terminalIdEast,
        arrivalTerminalId: terminalIdWest,
        route,
        now,
      });
      lowerSource = "missing";
    }
  }

  // --------------------
  // LOWER lane (slot 2)
  // --------------------
  if (lowerRaw) {
    const lowerDirMeta = deriveDirectionWithSchedule(
      lowerRaw,
      scheduledLower,
      terminalIdWest,
      terminalIdEast,
      "EAST_TO_WEST"
    );

    lowerLane = buildLaneFromVessel(lowerRaw, {
      laneId: "LOWER",
      positionNumber: 2,
      direction: lowerDirMeta.direction,
      departureTerminalId: lowerDirMeta.departureTerminalId,
      arrivalTerminalId: lowerDirMeta.arrivalTerminalId,
      route,
      now,
    });

    lowerSource = "live";
  }

  // >>> INSERT HERE <<<
  if (lowerLane && lowerRaw && lowerRaw.isSynthetic) {
    lowerLane.isStale = true;
  }

  // Snap stale lanes to dock if we've passed their ETA.
  upperLane = snapStaleLaneToDockIfArrived(upperLane, now);
  lowerLane = snapStaleLaneToDockIfArrived(lowerLane, now);

  // Compute Cannon dock metadata (dockStartTime, dockStartIsSynthetic, dockArcFraction)
  // based on per-route, per-lane history.
  upperLane = updateDockMetaForLane(route.routeId, "upper", upperLane, now);
  lowerLane = updateDockMetaForLane(route.routeId, "lower", lowerLane, now);

  // ---- Fallback classification for meta ----
  let fallbackMode = "live";
  let reason = "ok";

  const anyNonLive =
    (upperSource !== "live") || (lowerSource !== "live");

  if (anyNonLive) {
    fallbackMode = "partial";
    // Distinguish between missing and stale lanes for debugging.
    const anyMissing =
      (upperSource === "missing") || (lowerSource === "missing");
    if (anyMissing) {
      reason = "missing_lane";
    } else {
      reason = "stale_lane";
    }
  }

  // Route-level staleness: true if any lane is not live.
  // If we ever used a backend fallback path, force this true and tag the reason.
  let vesselsStale = anyNonLive;
  if (usedFallback) {
    vesselsStale = true;
    if (reason === "ok") {
      reason = "api_error";
    } else {
      reason = `${reason}_api_error`;
    }
  }

  // For triangle / liveTerminals routes, surface schedule-based next departures.
  if (laneStrategy === "liveTerminals") {
    nextDepartures = await deriveNextDeparturesForLeg(
      route,
      terminalIdWest,
      terminalIdEast,
      now
    );
  }

  return {
    route: {
      routeId: route.routeId,

      description: route.description,
      crossingTimeMinutes: route.crossingTimeMinutes,
      terminalNameWest: route.terminalNameWest,
      terminalNameEast: route.terminalNameEast,
      terminalIdWest,
      terminalIdEast,
      labelWest,
      labelEast,
    },
    lanes: {
      upper: upperLane,
      lower: lowerLane,
    },
    capacity: capacity || null,
    meta: {
      lastUpdatedVessels: nowIso,
      lastUpdatedCapacity: capacityLastUpdatedIso,
      vesselsStale,
      capacityStale,
      serverTime: nowIso,
      fallback: {
        mode: fallbackMode,
        lanes: {
          upper: upperSource, // "live" | "stale" | "missing"
          lower: lowerSource,
        },
      },
      reason,
      nextDepartures,
    },
  };
}

module.exports = {
  buildDotState,
};
