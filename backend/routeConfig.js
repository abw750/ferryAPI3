// backend/routeConfig.js
// Minimal route → terminal mapping.
// Only stores what the user (or upstream table) actually assigns:
// - routeId
// - description
// - terminalNameWest / terminalNameEast
// - crossingTimeMinutes

const ROUTES = [
  {
    routeId: 5,
    description: "Seattle / Bainbridge Island",
    terminalNameWest: "Bainbridge Island",
    terminalNameEast: "Seattle",
    crossingTimeMinutes: 35,
  },
  {
    routeId: 1,
    description: "Pt. Defiance / Tahlequah",
    terminalNameWest: "Point Defiance",
    terminalNameEast: "Tahlequah",
    crossingTimeMinutes: 15,
  },
  {
    routeId: 3,
    description: "Seattle / Bremerton",
    terminalNameWest: "Bremerton",
    terminalNameEast: "Seattle",
    crossingTimeMinutes: 60,
  },  
  {
    routeId: 6,
    description: "Edmonds / Kingston",
    terminalNameWest: "Kingston",
    terminalNameEast: "Edmonds",
    crossingTimeMinutes: 30,
  },
  {
    routeId: 7,
    description: "Mukilteo / Clinton",
    terminalNameWest: "Clinton",
    terminalNameEast: "Mukilteo",
    crossingTimeMinutes: 20,
  },
  {
    routeId: 8,
    description: "Port Townsend / Coupeville",
    terminalNameWest: "Port Townsend",
    terminalNameEast: "Coupeville", 
    crossingTimeMinutes: 35,
  },
    {
    routeId: 13,
    description: "Fauntleroy (West Seattle) / Southworth",
    terminalNameWest: "Southworth",
    terminalNameEast: "Fauntleroy",
    crossingTimeMinutes: 40,
  },
  {
    routeId: 14,
    description: "Fauntleroy (West Seattle) / Vashon",
    terminalNameWest: "Vashon Island",
    terminalNameEast: "Fauntleroy",
    crossingTimeMinutes: 20,
  },
  {
    routeId: 15,
    description: "Southworth / Vashon",
    terminalNameWest: "Vashon Island",
    terminalNameEast: "Southworth",
    crossingTimeMinutes: 10,
  },
];

function getRoutes() {
  return ROUTES;
}

function getRouteById(routeId) {
  const idNum = Number(routeId);
  return ROUTES.find((r) => r.routeId === idNum) || null;
}

module.exports = {
  getRoutes,
  getRouteById,
};
