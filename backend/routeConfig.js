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
    laneStrategy: "schedule",
    },
  {
    routeId: 1,
    description: "Pt. Defiance / Tahlequah",
    terminalNameWest: "Point Defiance",
    terminalNameEast: "Tahlequah",
    crossingTimeMinutes: 15,
    laneStrategy: "schedule",
    },
  {
    routeId: 3,
    description: "Seattle / Bremerton",
    terminalNameWest: "Bremerton",
    terminalNameEast: "Seattle",
    crossingTimeMinutes: 60,
    laneStrategy: "schedule",
    },  
  {
    routeId: 6,
    description: "Edmonds / Kingston",
    terminalNameWest: "Kingston",
    terminalNameEast: "Edmonds",
    crossingTimeMinutes: 30,
    laneStrategy: "schedule",
    },
  {
    routeId: 7,
    description: "Mukilteo / Clinton",
    terminalNameWest: "Clinton",
    terminalNameEast: "Mukilteo",
    crossingTimeMinutes: 20,
    laneStrategy: "schedule",
    },
  {
    routeId: 8,
    description: "Port Townsend / Coupeville",
    terminalNameWest: "Port Townsend",
    terminalNameEast: "Coupeville", 
    crossingTimeMinutes: 35,
    laneStrategy: "schedule",
    },

  // // Vashon triangle virtual pair: Fauntleroy <-> Vashon
  // {
  //   routeId: 13,
  //   description: "Fauntleroy / Vashon Island",
  //   terminalNameWest: "Fauntleroy",
  //   terminalNameEast: "Vashon Island",
  //   crossingTimeMinutes: 20,
  //   laneStrategy: "liveTerminals",
  //   hasCapacity: false,
  // },
  // {
  //   routeId: 14,
  //   description: "Vashon Island / Southworth",
  //   terminalNameWest: "Vashon Island",
  //   terminalNameEast: "Southworth",
  //   crossingTimeMinutes: 15,
  //   laneStrategy: "liveTerminals",
  //   hasCapacity: false,
  // },
  // {
  //   routeId: 15,
  //   description: "Southworth / Fauntleroy",
  //   terminalNameWest: "Southworth",
  //   terminalNameEast: "Fauntleroy",
  //   crossingTimeMinutes: 25,
  //   laneStrategy: "liveTerminals",
  //   hasCapacity: false,
  // },
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
