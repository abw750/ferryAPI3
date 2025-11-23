// backend/routeConfig.js
// Single source of truth for user selectable routes (canon section 1).

// Start with one hard coded route. You can add more later.
const ROUTES = [
  {
    routeId: 5,                        // Boats_Routes_Vessels.RouteID
    description: "Seattle ↔ Bainbridge Island",
    crossingTimeMinutes: 35,           // Boats_Routes_Vessels.CrossingTime

    terminalNameWest: "Bainbridge Island",
    terminalNameEast: "Seattle",

    labelWest: "BAINBRIDGE ISLAND",    // UI labels, all caps
    labelEast: "SEATTLE"
  }
];

// API for other backend modules
function getRoutes() {
  return ROUTES;
}

function getRouteById(routeId) {
  const idNum = Number(routeId);
  return ROUTES.find(r => r.routeId === idNum) || null;
}

module.exports = {
  getRoutes,
  getRouteById
};
