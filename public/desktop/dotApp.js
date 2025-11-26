// public/desktop/dotApp.js
console.log("dotApp.js loaded");

const routeInfoEl = document.getElementById("route-info");
const statusEl = document.getElementById("status");
const canvasEl = document.getElementById("canvas");

const REFRESH_MS = 30_000;
let currentRouteId = null;

async function init() {
  try {
    const routes = await fetchRoutes();
    if (!routes || routes.length === 0) {
      statusEl.textContent = "No routes available.";
      return;
    }

    // For now: pick the first route; user selection comes later.
    currentRouteId = routes[0].routeId;

    await refreshDotState();
    setInterval(refreshDotState, REFRESH_MS);
  } catch (err) {
    console.error("init error", err);
    statusEl.textContent = "Initialization failed: " + err.message;
  }
}

async function fetchRoutes() {
  const res = await fetch("/api/routes");
  if (!res.ok) {
    throw new Error("Failed to load routes: HTTP " + res.status);
  }
  const data = await res.json();
  if (!data || !Array.isArray(data.routes)) {
    throw new Error("Invalid routes payload");
  }
  return data.routes;
}

async function refreshDotState() {
  if (currentRouteId == null) {
    statusEl.textContent = "No route selected.";
    return;
  }

  statusEl.textContent = "Loading dot state…";

  try {
    const url = `/api/dot-state?routeId=${encodeURIComponent(currentRouteId)}`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error("Dot API failed: HTTP " + res.status);
    }
    const state = await res.json();
    renderDotState(state);
  } catch (err) {
    console.error("refreshDotState error", err);
    statusEl.textContent = "Error loading dot state: " + err.message;
  }
}

function classifyLaneStatusDot(lane, fallbackStatus) {
  const fb = (fallbackStatus || "").toLowerCase();

  // Backend explicitly says "missing" → hide.
  if (fb === "missing") {
    return "missing";
  }

  // No lane object at all.
  if (!lane) {
    return "missing";
  }

  const hasRealVessel =
    lane.vesselId != null &&
    lane.vesselName &&
    String(lane.vesselName).trim().toLowerCase() !== "unknown";

  const phase = (lane.phase || "").toUpperCase();
  const hasTiming =
    !!(lane.scheduledDeparture ||
       lane.scheduledDepartureTime ||
       lane.eta ||
       lane.estimatedArrivalTime ||
       lane.currentArrivalTime);

  const looksNullSkeleton =
    !hasRealVessel &&
    (!phase || phase === "UNKNOWN") &&
    !hasTiming;

  if (looksNullSkeleton) {
    return "missing";
  }

  if (lane.isStale) {
    return "stale";
  }

  return "live";
}

function normalizeLaneForRenderDot(lane, fallbackStatus) {
  const status = classifyLaneStatusDot(lane, fallbackStatus);
  if (status === "missing") {
    return null;
  }
  // live and stale both render; visual styling can distinguish later.
  return lane;
}

function renderDotState(state) {
  if (!state || !state.route || !state.lanes) {
    canvasEl.textContent = "Invalid state.";
    statusEl.textContent = "Invalid state returned from API.";
    return;
  }

  // Route header uses WEST/ EAST labels from backend
  const r = state.route;
  const left = r.labelWest || r.terminalNameWest || "";
  const right = r.labelEast || r.terminalNameEast || "";
  routeInfoEl.textContent = `${left} ↔ ${right} (Crossing ~${r.crossingTimeMinutes} min)`;

  // Status line
  const lastUpdated =
    state.meta && state.meta.lastUpdatedVessels
      ? state.meta.lastUpdatedVessels
      : new Date().toISOString();

  const staleFlag =
    state.meta && state.meta.vesselsStale ? " • STALE" : "";

  statusEl.textContent = `Last updated ${lastUpdated}${staleFlag}`;

  canvasEl.innerHTML = "";

  // Read lane fallback statuses
  const upperStatus =
    state.meta?.fallback?.lanes?.upper || null;
  const lowerStatus =
    state.meta?.fallback?.lanes?.lower || null;

  const rawUpper = state.lanes.upper || null;
  const rawLower = state.lanes.lower || null;

  const upperLane = normalizeLaneForRenderDot(rawUpper, upperStatus);
  const lowerLane = normalizeLaneForRenderDot(rawLower, lowerStatus);

  if (!upperLane && !lowerLane) {
    canvasEl.textContent = "No active lanes for this route.";
    return;
  }

  if (upperLane) {
    canvasEl.appendChild(
      renderLane("Upper lane", upperLane, left, right, upperStatus)
    );
  }

  if (lowerLane) {
    canvasEl.appendChild(
      renderLane("Lower lane", lowerLane, left, right, lowerStatus)
    );
  }
}

// -----------------------------------------------------------------------------
// LANE RENDERING — PURELY EAST/WEST LOGIC, ROUTE-AGNOSTIC
// -----------------------------------------------------------------------------
function renderLane(labelText, laneState, labelWest, labelEast, laneStatus) {
  const laneDiv = document.createElement("div");
  laneDiv.className = "lane";

  // Live vs non-live lane visual
  const s = (laneStatus || "").toLowerCase();
  laneDiv.classList.add(s === "live" ? "lane-live" : "lane-nonlive");

  const dir = (laneState.direction || "").toUpperCase();

  // WEST = left label; EAST = right label
  const from = labelWest;
  const to = labelEast;

  const arrow = dir === "EAST_TO_WEST" ? "←" : "→";

  const header = document.createElement("div");
  header.className = "lane-label";
  header.textContent = `${from} ${arrow} ${to} (${labelText})`;
  laneDiv.appendChild(header);

  // Track
  const trackDiv = document.createElement("div");
  trackDiv.className = "lane-track";

  // Dot
  const dot = document.createElement("div");
  dot.className = "lane-dot";

  const phase = (laneState.phase || "").toUpperCase();
  if (phase === "UNDERWAY") dot.classList.add("underway");
  if (phase === "AT_DOCK") dot.classList.add("at-dock");

  // Direction-based coloring (global rules)
  if (dir === "WEST_TO_EAST") {
    dot.classList.add("dir-west-east"); // green
  } else if (dir === "EAST_TO_WEST") {
    dot.classList.add("dir-east-west"); // red
  }

  // Position mapping
  let pos = laneState.dotPosition;
  if (typeof pos !== "number" || !isFinite(pos)) pos = 0;
  pos = Math.min(1, Math.max(0, pos));

  // WEST → EAST = left→right
  // EAST → WEST = right→left
  const leftPct =
    dir === "EAST_TO_WEST"
      ? (1 - pos) * 100
      : pos * 100;

  dot.style.left = `${leftPct}%`;
  dot.style.transform = "translateX(-50%)";

  trackDiv.appendChild(dot);
  laneDiv.appendChild(trackDiv);

  // Vessel label below
  const vesselLabel = document.createElement("div");
  vesselLabel.className = "vessel-label";
  vesselLabel.textContent =
    `${laneState.vesselName || "Unknown vessel"} (${phase})`;
  laneDiv.appendChild(vesselLabel);

  return laneDiv;
}

// Start application
init();
