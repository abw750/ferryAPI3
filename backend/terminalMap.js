// backend/terminalMap.js
// Derive WSDOT terminal IDs from terminal names.
// For now this is a minimal hard coded map; later this can be driven by
// Status_Terminals or your canon table instead of code.

const TERMINAL_NAME_TO_ID = {
  
  // Canonical SEA-BI mapping
  "Bainbridge Island": 3,
  "Seattle": 7
};

// Optional: resolve terminal IDs for a route using the routedetails API.
// This is non-breaking: callers must opt in and provide fetchRouteDetailsFn.
// Optional: resolve terminal IDs for a route using the routedetails API.
// This is non-breaking: callers must opt in and provide fetchRouteDetailsFn.
async function resolveTerminalIdsFromRouteDetails(routeId, fetchRouteDetailsFn, now) {
  if (!routeId || !fetchRouteDetailsFn || !now) return null;

  const tripDateText = now.toISOString().slice(0, 10);

  let details;
  try {
    details = await fetchRouteDetailsFn(routeId, tripDateText);
  } catch (_err) {
    // On any error, let the caller fall back to name-based mapping.
    return null;
  }

  if (!details) {
    return null;
  }

  // Support both shapes:
  //  1) { TerminalCombos: [ { DepartingTerminalID, ArrivingTerminalID, ... }, ... ] }
  //  2) [ { DepartingTerminalID, ArrivingTerminalID, ... }, ... ]
  let combos = null;

  if (Array.isArray(details.TerminalCombos)) {
    combos = details.TerminalCombos;
  } else if (Array.isArray(details)) {
    combos = details;
  }

  if (!Array.isArray(combos) || combos.length === 0) {
    return null;
  }

  const combo = combos[0];
  if (!combo) return null;

  const dep = combo.DepartingTerminalID;
  const arr = combo.ArrivingTerminalID;

  if (dep == null || arr == null) return null;

  return {
    terminalIdWest: Number(dep),
    terminalIdEast: Number(arr),
  };
}


function getTerminalIdByName(name) {
  if (!name) return null;
  const key = String(name).trim();
  if (Object.prototype.hasOwnProperty.call(TERMINAL_NAME_TO_ID, key)) {
    return TERMINAL_NAME_TO_ID[key];
  }
  return null;
}

function getTerminalIdsForRoute(route) {
  if (!route) {
    return { terminalIdWest: null, terminalIdEast: null };
  }

  const terminalIdWest = getTerminalIdByName(route.terminalNameWest);
  const terminalIdEast = getTerminalIdByName(route.terminalNameEast);

  return {
    terminalIdWest,
    terminalIdEast
  };
}

module.exports = {
  getTerminalIdByName,
  getTerminalIdsForRoute, 
  resolveTerminalIdsFromRouteDetails,
};
