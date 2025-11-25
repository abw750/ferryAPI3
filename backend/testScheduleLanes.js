// backend/testScheduleLanes.js
//
// Correct schedule/lane inspection using actual terminalId
// resolution inside buildDotState (Cannon Section 2 + 3).

const { getRouteById } = require("./routeConfig");
const { fetchDailySchedule } = require("./wsdotClient");
const { buildDotState } = require("./dotState");

async function inspectRoute(routeId) {
  const route = getRouteById(routeId);
  if (!route) {
    console.log(`Route ${routeId}: no routeConfig entry`);
    return;
  }

  console.log(`\n=== Route ${routeId}: ${route.description} ===`);

  // FIRST: get the real terminal IDs resolved by buildDotState()
  let state;
  try {
    state = await buildDotState(routeId);
  } catch (err) {
    console.log(`buildDotState error: ${err.message || err}`);
    return;
  }

  const terminalIdWest = state.route.terminalIdWest;
  const terminalIdEast = state.route.terminalIdEast;

  console.log(`terminalIdWest: ${terminalIdWest}`);
  console.log(`terminalIdEast: ${terminalIdEast}`);

  if (terminalIdWest == null) {
    console.log("Cannot proceed (West terminal unresolved)");
    return;
  }

  // SECOND: check schedule rows
  const now = new Date();
  const tripDateText = now.toISOString().slice(0, 10);

  let rows;
  try {
    rows = await fetchDailySchedule(routeId, tripDateText);
  } catch (err) {
    console.log(`Schedule fetch error: ${err.message || err}`);
    return;
  }

  const westRows = rows.filter(
    (r) =>
      Number(r.routeId) === Number(routeId) &&
      Number(r.departingTerminalId) === Number(terminalIdWest)
  );

  console.log(`total westRows = ${westRows.length}`);

  const upperRow = westRows.find((r) => Number(r.vesselPositionNumber) === 1) || null;
  const lowerRow = westRows.find((r) => Number(r.vesselPositionNumber) === 2) || null;

  console.log("UPPER slot:", upperRow ? {
    vesselId: upperRow.vesselId,
    vesselName: upperRow.vesselName,
    vesselPositionNumber: upperRow.vesselPositionNumber,
  } : null);

  console.log("LOWER slot:", lowerRow ? {
    vesselId: lowerRow.vesselId,
    vesselName: lowerRow.vesselName,
    vesselPositionNumber: lowerRow.vesselPositionNumber,
  } : null);
}

async function run() {
  const routes = [15];

  for (const r of routes) {
    await inspectRoute(r);
  }
}

run().catch((err) => {
  console.error("Unexpected error:", err);
});
