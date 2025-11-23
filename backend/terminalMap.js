// backend/terminalMap.js
// Derive WSDOT terminal IDs from terminal names.
// For now this is a minimal hard coded map; later this can be driven by
// Status_Terminals or your canon table instead of code.

const TERMINAL_NAME_TO_ID = {
  // Canonical SEA-BI mapping
  "Bainbridge Island": 3,
  "Seattle": 7
};

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
  getTerminalIdsForRoute
};
