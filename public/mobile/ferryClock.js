// public/mobile/ferryClock.js — FerryClock3 analog overlay scaffold (with debug logging).

(function () {
  const REFRESH_MS = 10_000;
  let currentRouteId = null;
  let refreshTimerId = null;
  let routeSelectEl = null;
  let routeChangeBtnEl = null;
  let routeInfoEl = null;
  let layersRef = null;

  // --- clock geometry ---
  const CX = 200;
  const CY = 200;

  // color palette
  const COLOR_STRONG_LTR = "#128b56c0"; // BI → SEA transit segment (semi transparent)
  const COLOR_STRONG_RTL = "#ff2121b9"; // SEA → BI transit segment (semi transparent)
  const COLOR_TRACK       = "#c8c7c7b2"; // grey track (semi transparent)

  // Opaque dot colors, aligned with CSS lane-dot direction palette
  const COLOR_DOT_LTR   = "#10b981"; // WEST → EAST dot
  const COLOR_DOT_RTL   = "#ef4444"; // EAST → WEST dot

  const COLORS = {
    ltr:  { strong: COLOR_STRONG_LTR, light: COLOR_STRONG_LTR, dot: COLOR_DOT_LTR },
    rtl:  { strong: COLOR_STRONG_RTL, light: COLOR_STRONG_RTL, dot: COLOR_DOT_RTL },
    track: COLOR_TRACK,
  };

  // Global palette used by all overlays (lanes, pies, arcs)
  window.FerryPalette = {
    strongLtr: COLOR_STRONG_LTR,
    strongRtl: COLOR_STRONG_RTL,
    track:     COLOR_TRACK,
    dotLtr:    COLOR_DOT_LTR,
    dotRtl:    COLOR_DOT_RTL,
  };

  const ICON_SRC  = "/icons/ferry.png";
  const SHIP_W    = 18;    // px
  const SHIP_H    = 18;    // px
  const SHIP_GAP  = 4;     // vertical gap above the bar
  const LABEL_GAP = 15;    // px
  const BAR_W     = 150;   // px, transit bar width
  const BAR_Y_OFFSET   = 50; // px, vertical offset from arrow row to transit bar
  const BAR_THICKNESS  = 8; // px, thickness for both track and colored segment
  const STROKE_CAP     = "round";

  // Dock arcs: radii match faceRenderer rings
  const DOCK_ARC_THICKNESS = 8;   // stroke width inside each white band
  const R_DOCK_UPPER = 173.5;       // outer lane: midpoint of 160–178 band
  const R_DOCK_LOWER = 164.5;       // inner lane: midpoint above numerals at ~148

  // ---------- entry point ----------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }

  async function start() {
    const layers = await waitForFaceLayers();
    if (!layers) {
      console.warn("[ferryClock] getFaceLayers() not available after wait; aborting overlay.");
      return;
    }
    console.log("[ferryClock] got face layers:", layers);

    layersRef = layers;

    try {
      console.log("[ferryClock] fetching routes from /api/routes");
      const routes = await fetchRoutes();

      if (!routes || !routes.length) {
        console.warn("[ferryClock] no routes available from /api/routes");
        drawDebug(layers, "NO ROUTES");
        return;
      }

      // Initialize route selector + button, and establish initial currentRouteId.
      initRouteControls(routes, layers);

      // Initial state fetch for the selected route.
      await refreshDotState(layers);
      refreshTimerId = setInterval(() => refreshDotState(layers), REFRESH_MS);
    } catch (err) {
      console.error("[ferryClock] init error:", err);
      drawDebug(layers, "INIT ERROR");
    }
  }

    function dispatchRouteSelected(routeId) {
    try {
      window.dispatchEvent(
        new CustomEvent("routeSelected", {
          detail: { routeId }
        })
      );
    } catch (err) {
      console.error("[ferryClock] dispatchRouteSelected error:", err);
    }
  }

  function initRouteControls(routes, layers) {
    routeSelectEl = document.getElementById("route-select");
    routeChangeBtnEl = document.getElementById("route-change-btn");
    routeInfoEl = document.getElementById("route-info");

    if (!routeSelectEl || !routeChangeBtnEl) {
      console.warn("[ferryClock] route controls not found in DOM");
      return;
    }


    // Clear any existing options.
    while (routeSelectEl.firstChild) {
      routeSelectEl.removeChild(routeSelectEl.firstChild);
    }

    // Populate selector with descriptions from routeConfig.
    routes.forEach((route) => {
      const opt = document.createElement("option");
      opt.value = String(route.routeId);
      opt.textContent = route.description || `Route ${route.routeId}`;
      routeSelectEl.appendChild(opt);
    });

    // Establish initial routeId (persisting until next boot).
    if (routes.length > 0) {
      if (currentRouteId == null) {
        currentRouteId = routes[0].routeId;
      }
      routeSelectEl.value = String(currentRouteId);
      dispatchRouteSelected(currentRouteId);

      // Update header route description.
      if (routeInfoEl) {
        const currentRoute = routes.find((r) => r.routeId === currentRouteId);
        routeInfoEl.textContent = currentRoute
          ? (currentRoute.description || "")
          : "";
      }
    }

    // Button toggles the dropdown visibility.
    routeChangeBtnEl.addEventListener("click", () => {
      if (!routeSelectEl) return;
      const isHidden =
        routeSelectEl.style.display === "none" ||
        routeSelectEl.style.display === "";
      routeSelectEl.style.display = isHidden ? "inline-block" : "none";
    });

    // When the user selects a different route, update currentRouteId
    // and refresh the clock, then hide the dropdown again.
    routeSelectEl.addEventListener("change", () => {
      const value = routeSelectEl.value;
      const newRouteId = value ? Number(value) : null;

      // If no change, just hide dropdown.
      if (!newRouteId || newRouteId === currentRouteId) {
        routeSelectEl.style.display = "none";
        return;
      }

      currentRouteId = newRouteId;
      dispatchRouteSelected(currentRouteId);

      // Update header description with pending refresh note.
      if (routeInfoEl) {
        const currentRoute = routes.find((r) => r.routeId === currentRouteId);
        const desc = currentRoute ? (currentRoute.description || "") : "";
        routeInfoEl.textContent = desc + " (pending refresh...)";
      }

      // Trigger refresh immediately (does not block UI).
      if (layersRef) {
        refreshDotState(layersRef);
      }

      // Hide dropdown right away.
      routeSelectEl.style.display = "none";
    });
  }

  // ---------- backend calls (mirror dotApp.js contract) ----------
  async function fetchRoutes() {
    const res = await fetch("/api/routes");
    if (!res.ok) {
      throw new Error("Failed to load routes: HTTP " + res.status);
    }
    const data = await res.json();
    if (!data || !Array.isArray(data.routes)) {
      throw new Error("Invalid routes payload from /api/routes");
    }
    return data.routes;
  }

  async function refreshDotState(layers) {
    // Always prefer the current value in the route selector, if present.
    if (routeSelectEl && routeSelectEl.value) {
      const maybeId = Number(routeSelectEl.value);
      if (!Number.isNaN(maybeId) && maybeId > 0) {
        currentRouteId = maybeId;
      }
    }

    if (currentRouteId == null) {
      console.warn("[ferryClock] no routeId selected yet");
      drawDebug(layers, "NO ROUTE");
      return;
    }

    const url = `/api/dot-state?routeId=${encodeURIComponent(currentRouteId)}`;

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Dot API failed: HTTP " + res.status);
      }
      const state = await res.json();

      renderAnalogOverlay(state, layers);
    } catch (err) {
      console.error("[ferryClock] refreshDotState error:", err);
      drawDebug(layers, "STATE ERROR");
    }
  }

  // ---------- overlay rendering ----------
  function renderAnalogOverlay(state, layers) {
    layers.clear();

    // Clear pending refresh message if present.
    if (routeInfoEl) {
      const base = routeInfoEl.textContent.replace(" (pending refresh...)", "");
      routeInfoEl.textContent = base;
    }

    const ns = "http://www.w3.org/2000/svg";
    const now = new Date();
    const dockArcsGroup = ensureDockArcGroup(layers);
    const capacityGroup = ensureCapacityGroup(layers);

    // Helper: create SVG element
    function elNS(tag, attrs) {
      const n = document.createElementNS(ns, tag);
      if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
      return n;
    }

    function line(x1, y1, x2, y2, stroke, w) {
      // Use inline style so Cannon direction color wins over external CSS
      const n = elNS("line", {
        x1,
        y1,
        x2,
        y2
      });
      n.setAttribute(
        "style",
        `stroke:${stroke};stroke-width:${w};stroke-linecap:${STROKE_CAP}`
      );
      return n;
    }

    function arrowHead(x, y, angleRad, stroke, w, size) {
      const s = size || 8;
      const p1x = x + Math.cos(angleRad + Math.PI - 0.9) * s;
      const p1y = y + Math.sin(angleRad + Math.PI - 0.9) * s;
      const p2x = x + Math.cos(angleRad + Math.PI + 0.9) * s;
      const p2y = y + Math.sin(angleRad + Math.PI + 0.9) * s;
      return elNS("path", {
        d: `M ${x} ${y} L ${p1x} ${p1y} M ${x} ${y} L ${p2x} ${p2y}`,
        stroke,
        "stroke-width": w,
        fill: "none",
        "stroke-linecap": STROKE_CAP
      });
    }

function circleDot(x, y, r, fill) {
  return elNS("circle", {
    cx: x,
    cy: y,
    r: r,
    fill,
    opacity: "1"   // FORCE fully opaque dot
  });
}

    // Draws a solid bar between x1 and x2 centered at (y) with given thickness.
    function barRect(x1, x2, y, thickness, fill) {
      const xStart = Math.min(x1, x2);
      const width = Math.abs(x2 - x1);
      const yTop = y - thickness / 2;
      const radius = thickness / 2;
      return elNS("rect", {
        x: xStart,
        y: yTop,
        width,
        height: thickness,
        fill,
        rx: radius,
        ry: radius
      });
    }

    function addShipIcon(g, cx, barY) {
      const x = cx - SHIP_W / 2;
      const y = barY - SHIP_H - SHIP_GAP;

      // Pick icon based on current theme: light = default ferry.png, dark = ferry-white.png.
      const isLight = document.body.classList.contains("theme-light");
      const iconSrc = isLight
        ? ICON_SRC
        : ICON_SRC.replace(/ferry(-white)?\.png$/i, "ferry-white.png");

      const img = elNS("image", {
        href: iconSrc,
        x, y,
        width: SHIP_W, height: SHIP_H,
        preserveAspectRatio: "xMidYMid meet"
      });
      g.appendChild(img);
    }

    // Helper: text label
    function addText(group, text, x, y, opts = {}) {
      const t = elNS("text", {
        x: String(x),
        y: String(y),
        "text-anchor": opts.anchor || "middle",
        fill: opts.fill || "#111827",
        "font-size": opts.fontSize || "12"
      });
      t.textContent = text;
      group.appendChild(t);
    }

    // Helper: normalize time labels for the clock
    function formatClockLabel(raw) {
      if (!raw || typeof raw !== "string") return "";
      const trimmed = raw.trim();
      if (!trimmed) return "";

      // Already in plain hh:mm AM/PM → leave as-is
      if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(trimmed)) {
        return trimmed;
      }

      // Try ISO / Date-like strings
      const d = new Date(trimmed);
      if (!Number.isNaN(d.getTime())) {
        return d.toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit"
        });
      }

      // Fallback: show whatever we got
      return trimmed;
    }

    // ---- Dock arc helpers (Cannon: arcs in outer/inner rings) ----

    function polarToCartesian(cx, cy, r, angleRad) {
      return {
        x: cx + r * Math.cos(angleRad),
        y: cy + r * Math.sin(angleRad),
      };
    }

    // Returns an SVG arc path from startAngle to endAngle (radians, 0 at 3 oclock, CCW)
    function describeArcPath(cx, cy, r, startAngle, endAngle) {
      const start = polarToCartesian(cx, cy, r, startAngle);
      const end   = polarToCartesian(cx, cy, r, endAngle);

      // Normalize delta to [0, 2π]
      let delta = endAngle - startAngle;
      while (delta < 0) delta += Math.PI * 2;
      while (delta > Math.PI * 2) delta -= Math.PI * 2;

      const largeArcFlag = delta > Math.PI ? 1 : 0;
      const sweepFlag = 1; // clockwise around dial

      return [
        "M", start.x, start.y,
        "A", r, r, 0, largeArcFlag, sweepFlag, end.x, end.y,
      ].join(" ");
    }

    // Expose for external overlay modules (capacity pies) while keeping
    // the implementation owned here.
    window.FerryDescribeArcPath = describeArcPath;

    // Shared geometry descriptor for all overlay modules (lanes, arcs, pies).
    window.FerryGeometry = {
      CX,
      CY,
      laneRows: {
        upper: 95,
        lower: 305,
      },
      barWidth: BAR_W,
      barYOffset: BAR_Y_OFFSET,
      barThickness: BAR_THICKNESS,
      dockRadii: {
        upper: R_DOCK_UPPER,
        lower: R_DOCK_LOWER,
      },
      dockArcThickness: DOCK_ARC_THICKNESS,
      polarToCartesian,
      describeArcPath,
    };

    // Ensure a stable group for dock arcs; keep them behind top/bottom rows.
    function ensureDockArcGroup(layers) {
      const gOverlay = layers.overlay;
      if (!gOverlay) return null;

      let g = gOverlay.querySelector("#dock-arcs");
      if (!g) {
        g = elNS("g", { id: "dock-arcs" });
        // Insert as first child so arcs render behind rows.
        if (gOverlay.firstChild) {
          gOverlay.insertBefore(g, gOverlay.firstChild);
        } else {
          gOverlay.appendChild(g);
        }
      }
      // Clear arcs each render
      g.innerHTML = "";
      return g;
    }

    function drawDockArcForLane(arcsGroup, lane, laneKey, now) {
      if (!arcsGroup || !lane) return;
      if (!lane.atDock) return;
      if (!lane.dockStartTime) return;

      const startDate = new Date(lane.dockStartTime);
      const startMs = startDate.getTime();
      if (!Number.isFinite(startMs)) return;

      const nowMs = now.getTime();
      const elapsedMs = nowMs - startMs;
      if (elapsedMs <= 0) return;

      const elapsedSeconds = elapsedMs / 1000;
      // 0–3600 seconds map to 0–1 arc fraction
      let frac = elapsedSeconds / 3600;
      if (frac <= 0) return;
      if (frac > 1) frac = 1;

      // Choose ring radius per lane
      const radius = laneKey === "upper" ? R_DOCK_UPPER : R_DOCK_LOWER;

      // Anchor: minute hand at dockStartTime, local time (minutes + seconds)
      const localMinutes = (startDate.getMinutes() + startDate.getSeconds() / 60) % 60;
      const startAngle = (Math.PI / 30) * localMinutes - Math.PI / 2;

      // Span: fraction of full circle, clockwise
      const spanAngle = frac * Math.PI * 2;
      const endAngle = startAngle + spanAngle;

      // Color semantics: match lane direction palette, strong vs light
      const dirKey = laneDir(lane);
      let scheme;
      if (dirKey === "rtl") {
        scheme = COLORS.rtl;
      } else if (dirKey === "ltr") {
        scheme = COLORS.ltr;
      } else {
        return; // unknown direction, do not draw arc
      }

      const lowConfidence = !!lane.dockStartIsSynthetic || !!lane.isStale;
      const strokeColor = lowConfidence ? scheme.light : scheme.strong;

      if (frac >= 0.999) {
        // Full circle: draw circle stroke instead of arc
        const circle = elNS("circle", {
          cx: String(CX),
          cy: String(CY),
          r: String(radius),
          fill: "none",
          stroke: strokeColor,
          "stroke-width": String(DOCK_ARC_THICKNESS),
        });
        arcsGroup.appendChild(circle);
      } else {
        const path = elNS("path", {
          d: describeArcPath(CX, CY, radius, startAngle, endAngle),
          fill: "none",
          stroke: strokeColor,
          "stroke-width": String(DOCK_ARC_THICKNESS),
          "stroke-linecap":"butt",
        });
        arcsGroup.appendChild(path);
      }
    }

        // ---- Capacity donuts (Cannon: auto spaces per terminal) ----

    function ensureCapacityGroup(layers) {
      const gOverlay = layers.overlay;
      if (!gOverlay) return null;

      let g = gOverlay.querySelector("#capacity-pies");
      if (!g) {
        g = elNS("g", { id: "capacity-pies" });
        // Put pies above dock arcs but below lanes.
        const dock = gOverlay.querySelector("#dock-arcs");
        if (dock && dock.nextSibling) {
          gOverlay.insertBefore(g, dock.nextSibling);
        } else {
          gOverlay.appendChild(g);
        }
      }
      g.innerHTML = "";
      return g;
    }

    if (!state || !state.lanes) {
      console.warn("[ferryClock] invalid state payload for overlay; drawing DEBUG only");
      addText(layers.top, "NO STATE", CX, CY);
      return;
    }

    const rawUpperLane = state.lanes.upper || null;
    const rawLowerLane = state.lanes.lower || null;

    const route = state.route || {};
    const meta = state.meta || {};
    const fallbackMeta = meta.fallback || {};
    const laneFallback = fallbackMeta.lanes || {};

    const upperFallbackStatus = laneFallback.upper || null;
    const lowerFallbackStatus = laneFallback.lower || null;

    const upperLane = normalizeLaneForRender(rawUpperLane, upperFallbackStatus);
    const lowerLane = normalizeLaneForRender(rawLowerLane, lowerFallbackStatus);

    if (!upperLane && !lowerLane) {
      console.warn("[ferryClock] no upper/lower lanes in state; drawing DEBUG only");
      addText(layers.top, "NO LANES", CX, CY);
      return;
    }

    function classifyLaneStatus(lane, fallbackStatus) {
      const fb = (fallbackStatus || "").toLowerCase();

      // If backend explicitly marks lane as missing, honor that.
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
        // Skeleton placeholder: treat as effectively no lane.
        return "missing";
      }

      if (lane.isStale) {
        return "stale";
      }

      return "live";
    }

    function normalizeLaneForRender(lane, fallbackStatus) {
      const status = classifyLaneStatus(lane, fallbackStatus);
      if (status === "missing") {
        return null;
      }
      // For now live vs stale both render as present; styling can
      // differentiate later if needed.
      return lane;
    }

// Dock arcs: outer ring for upper lane, inner ring for lower lane
function renderDockArcOverlay(group, upperLane, lowerLane, now) {
  if (!group) return;

  const hasModule =
    window.FerryDockArcOverlay &&
    typeof window.FerryDockArcOverlay.render === "function";

  if (hasModule) {
    try {
      window.FerryDockArcOverlay.render({
        group,
        upperLane,
        lowerLane,
        now,
        geometry: window.FerryGeometry || null,
      });

      // Module handled drawing; no fallback.
      return;
    } catch (err) {
      console.error("[ferryClock] FerryDockArcOverlay.render error:", err);
      // fall through to fallback below
    }
  } else {
    console.warn("[ferryClock] FerryDockArcOverlay module missing; using fallback arcs");
  }

  // Only reach here if module is missing or failed → use legacy fallback.
  console.warn("[ferryClock] DockArcOverlay fallback path used");

  if (upperLane) drawDockArcForLane(group, upperLane, "upper", now);
  if (lowerLane) drawDockArcForLane(group, lowerLane, "lower", now);
}

renderDockArcOverlay(dockArcsGroup, upperLane, lowerLane, now);

    // Capacity pies: west / east auto slots (Cannon pies) - render from capacityOverlay.js
    function renderCapacityOverlay(capacityGroup, state) {
      if (!capacityGroup) return;

      if (window.FerryCapacityOverlay &&
          typeof window.FerryCapacityOverlay.render === "function") {
        try {
          window.FerryCapacityOverlay.render({ group: capacityGroup, state });
        } catch (err) {
          console.error("[ferryClock] FerryCapacityOverlay.render error:", err);
        }
      }
    }
    
    if (capacityGroup) {
      renderCapacityOverlay(capacityGroup, state);
    }

    // Dial-side WEST / EAST labels using same precedence as dotApp (Cannon: backend route drives labels)
    const labelWestText =
      (route.labelWest && String(route.labelWest).trim()) ||
      (route.terminalNameWest && String(route.terminalNameWest).trim()) ||
      "";
    const labelEastText =
      (route.labelEast && String(route.labelEast).trim()) ||
      (route.terminalNameEast && String(route.terminalNameEast).trim()) ||
      "";

    if (labelWestText || labelEastText) {
      // Horizontal positions aligned with lane bars (Cannon: west=left, east=right)
      const barWidth = BAR_W;

      // Base radius from center to bar end, plus extra outward offset
      const offset = barWidth / 2 + 50; // 10px original + 50px outward

      // Symmetric positions on 9–3 axis
      const xWestLabel = CX - offset;
      const xEastLabel = CX + offset;

      // Vertically centered between upper and lower lanes (on 9–3 axis)
      const yMid = CY;

      // WEST label
      if (labelWestText) {
        const x = xWestLabel;
        const y = yMid;
        const t = elNS("text", {
          x: String(x),
          y: String(y),
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          // "font-weight": "bold",
          "font-size": "12",
          fill: "#2b2f9aff",
          transform: `rotate(-90 ${x} ${y})`,
        });
        t.textContent = labelWestText;
        layers.top.appendChild(t);
      }

      // EAST label
      if (labelEastText) {
        const x = xEastLabel;
        const y = yMid;
        const t = elNS("text", {
          x: String(x),
          y: String(y),
          "text-anchor": "middle",
          "dominant-baseline": "middle",
          // "font-weight": "bold",
          "font-size": "12",
          fill: "#2b2f9aff",
          transform: `rotate(90 ${x} ${y})`,
        });
        t.textContent = labelEastText;
        layers.top.appendChild(t);
      }
    }

    // Map direction enum to "ltr"/"rtl" and scheme
    function laneDir(lane) {
      const d = (lane?.direction || "").toUpperCase();
      if (d === "WEST_TO_EAST") return "ltr";
      if (d === "EAST_TO_WEST") return "rtl";
      return null;
    }

    // Expose for external overlay modules (dockArcOverlay, etc.)
    window.FerryLaneDir = laneDir;

    function isUnderway(lane) {
      const phase = (lane?.phase || "").toUpperCase();
      return phase === "UNDERWAY";
    }

    // Provide shared geometry + helpers to laneOverlay.js
    if (window.FerryLaneOverlay &&
        typeof window.FerryLaneOverlay.injectHelpers === "function") {
      try {
        window.FerryLaneOverlay.injectHelpers({
          CX,
          CY,
          laneDir,
          isUnderway,
          barRect,
          circleDot,
          addShipIcon,
          formatClockLabel,
          COLORS,
          BAR_W,
          BAR_THICKNESS,
          BAR_Y_OFFSET,
          LABEL_GAP,
        });
      } catch (err) {
        console.error("[ferryClock] FerryLaneOverlay.injectHelpers error:", err);
      }
    }

    // Straight bar geometry
    function drawLaneRow(group, lane, yRow) {
      if (!lane) return;
      const dirKey = laneDir(lane);
      const underway = isUnderway(lane);
      const scheme = dirKey === "rtl" ? COLORS.rtl : COLORS.ltr;
      const barWidth = BAR_W;
      const xL = CX - barWidth / 2;
      const xR = CX + barWidth / 2;
      const barY = (yRow < CY) ? (yRow + BAR_Y_OFFSET) : (yRow - BAR_Y_OFFSET);

      // ---- direction arrow on 12–6 axis ----
      if (dirKey) {
        const y0 = yRow;
        const halfLen = 28;
        const head = 8;
        const arrowColor = underway ? scheme.strong : scheme.light;
        const axL = CX - halfLen;
        const axR = CX + halfLen;

        group.appendChild(line(axL, y0, axR, y0, arrowColor, 3));

        if (dirKey === "ltr") {
          group.appendChild(arrowHead(axR, y0, 0, arrowColor, 3, head));
          if (!underway) group.appendChild(circleDot(axL, y0, 4, arrowColor));
        } else {
          group.appendChild(arrowHead(axL, y0, Math.PI, arrowColor, 3, head));
          if (!underway) group.appendChild(circleDot(axR, y0, 4, arrowColor));
        }
      } else {
        addText(group, "--", CX, yRow, { fontSize: "14", fill: "#999" });
      }

      // ---- transit bar + moving dot (using dotPosition) ----
      if (dirKey) {
        // 1) always draw grey track (full route as a thick bar)
        group.appendChild(barRect(xL, xR, barY, BAR_THICKNESS, COLORS.track));

        // normalized progress from backend
        let pos = lane.dotPosition;
        if (typeof pos !== "number" || !isFinite(pos)) pos = 0;
        pos = Math.max(0, Math.min(1, pos));

        let frac;
        if (dirKey === "rtl") {
          // EAST → WEST = right→left
          frac = 1 - pos;
        } else {
          // WEST → EAST = left→right
          frac = pos;
        }

        const xp = xL + frac * (xR - xL);

        if (underway) {
          // colored progress segment (already-transited portion) - semi transparent
          if (dirKey === "ltr") {
            group.appendChild(barRect(xL, xp, barY, BAR_THICKNESS, scheme.strong));
          } else {
            group.appendChild(barRect(xR, xp, barY, BAR_THICKNESS, scheme.strong));
          }

          // moving dot at the leading edge - fully opaque, on top
          group.appendChild(circleDot(xp, barY, 5.5, scheme.dot));
          addShipIcon(group, xp, barY);

        } else {
          // Not underway: dot only when lane is actually at the dock.
          // If neither underway nor atDock, we treat this as a scheduled-only
          // case: show the track and time label, but no dot/ship.
          const originIsWest = dirKey === "ltr";
          const originX = originIsWest ? xL : xR;

          if (lane.atDock) {
            group.appendChild(circleDot(originX, barY, 5.5, scheme.dot));
            addShipIcon(group, originX, barY);
          }
        }

        // ---- labels (simplified: sched at origin while docked, ETA at dest while underway) ----
        const labelY = barY + LABEL_GAP;
        const originX = dirKey === "ltr" ? xL : xR;
        const destX   = dirKey === "ltr" ? xR : xL;
        const originAnchor = dirKey === "ltr" ? "start" : "end";
        const destAnchor   = dirKey === "ltr" ? "end" : "start";
        const schedRaw = lane.scheduledDeparture || lane.scheduledDepartureTime || "";
        const etaRaw   = lane.eta || lane.estimatedArrivalTime || "";
        const sched = formatClockLabel(schedRaw);
        const eta   = formatClockLabel(etaRaw);

        if (!underway && sched) {
          addText(group, sched, originX, labelY, {
            anchor: originAnchor,
            fontSize: "10",
            fill: "#111"
          });
        } else if (underway && eta) {
          addText(group, eta, destX, labelY, {
            anchor: destAnchor,
            fontSize: "10",
            fill: "#111"
          });
        }
      }

      // ---- vessel name  ----
      const name = (lane.vesselName && String(lane.vesselName).trim()) || "—";
      const nameY = (yRow >= CY) ? (yRow - 12) : (yRow + 20);
      addText(group, name, CX, nameY, {
        fontSize: "12",
        fill: "#222"
      });
    }

    function renderLaneOverlay(topGroup, bottomGroup, upperLane, lowerLane, now) {
      if (!topGroup && !bottomGroup) return;

      // Allow external module to participate.
      if (window.FerryLaneOverlay &&
          typeof window.FerryLaneOverlay.render === "function") {
        try {
          // Reset sentinel before each render cycle.
          window.__LANE_OVERLAY_OK__ = false;

          window.FerryLaneOverlay.render({
            topGroup,
            bottomGroup,
            upperLane,
            lowerLane,
            now,
            CX,
            CY,
          });
        } catch (err) {
          console.error("[ferryClock] FerryLaneOverlay.render error:", err);
          window.__LANE_OVERLAY_OK__ = false;
        }
      }

      // If the module signaled success, skip fallback to avoid double-drawing.
      if (window.__LANE_OVERLAY_OK__ === true) {
        return;
      }

      // Fallback / baseline: original implementation.
      console.warn("[ferryClock] LaneOverlay fallback path used");

      if (upperLane) {
        drawLaneRow(topGroup, upperLane, 95);
      }

      if (lowerLane) {
        drawLaneRow(bottomGroup, lowerLane, 305);
      }
    }

    renderLaneOverlay(layers.top, layers.bottom, upperLane, lowerLane, now);
  }

  // Draws a central debug label if we fail early.
  function drawDebug(layers, msg) {
    if (!layers) return;
    layers.clear();

    const ns = "http://www.w3.org/2000/svg";
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", "200");
    t.setAttribute("y", "200");
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", "14");
    t.setAttribute("fill", "#ef4444");
    t.textContent = msg || "DEBUG";
    layers.top.appendChild(t);
  }

  // ---------- wait until faceRenderer has registered getFaceLayers ----------
  function waitForFaceLayers() {
    return new Promise(resolve => {
      if (typeof window.getFaceLayers === "function") {
        return resolve(window.getFaceLayers());
      }

      let attempts = 0;
      const maxAttempts = 50;
      const iv = setInterval(() => {
        attempts++;
        if (typeof window.getFaceLayers === "function") {
          clearInterval(iv);
          resolve(window.getFaceLayers());
        } else if (attempts >= maxAttempts) {
          clearInterval(iv);
          console.warn("[ferryClock] getFaceLayers() never appeared after", attempts, "checks");
          resolve(null);
        }
      }, 100);
    });
  }
    // Mobile long-press gesture: open/close route picker header.
  document.addEventListener("DOMContentLoaded", function () {
    var clock = document.getElementById("clockFace");
    var header = document.getElementById("mobile-header");
    var LONG_PRESS_MS = 700;
    var pressTimer = null;

    function openRoutePicker() {
      document.body.classList.add("route-picker-open");
    }

    function closeRoutePicker() {
      document.body.classList.remove("route-picker-open");
    }

    function startPress() {
      if (pressTimer !== null) return;
      pressTimer = setTimeout(function () {
        openRoutePicker();
        pressTimer = null;
      }, LONG_PRESS_MS);
    }

    function cancelPress() {
      if (pressTimer !== null) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    if (clock) {
      clock.addEventListener("mousedown", startPress);
      clock.addEventListener("touchstart", startPress, { passive: true });

      clock.addEventListener("mouseup", cancelPress);
      clock.addEventListener("mouseleave", cancelPress);
      clock.addEventListener("touchend", cancelPress);
      clock.addEventListener("touchcancel", cancelPress);
    }

    // Clicking the Done button in the header closes the picker and returns to clock.
    var doneBtn = document.getElementById("route-done-btn");
    if (doneBtn) {
      doneBtn.addEventListener("click", function () {
        closeRoutePicker();
      });
    }
    // Light/Dark theme toggle in the header.
    var themeBtn = document.getElementById("route-theme-toggle-btn");

    function applyTheme(isLight) {
      // Apply or remove the light theme class on <body>.
      document.body.classList.toggle("theme-light", isLight);

      // Update button label to reflect what clicking will do next.
      if (themeBtn) {
        themeBtn.textContent = isLight ? "Dark mode" : "Light mode";
      }

      // Swap any ferry icons inside the clock SVG based on theme, if present.
      var images = document.querySelectorAll("#clockFace image");
      if (images && images.length > 0) {
        images.forEach(function (img) {
          // Use whatever href/xlink:href is currently set as the base.
          var originalHref =
            img.getAttribute("data-href-original") ||
            img.getAttribute("href") ||
            img.getAttribute("xlink:href") ||
            "";

          if (!originalHref) return;

          // Cache the original once so we always know the light-mode asset.
          img.setAttribute("data-href-original", originalHref);

          var lightHref = originalHref.replace(/ferry-white\.png$/i, "ferry.png");
          var darkHref = lightHref.replace(/ferry\.png$/i, "ferry-white.png");

          var targetHref = isLight ? lightHref : darkHref;

          // Set both href and xlink:href for compatibility.
          img.setAttribute("href", targetHref);
          img.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", targetHref);
        });
      }
    }

    if (themeBtn) {
      // Initialize label based on current state (default is dark).
      var startingLight = document.body.classList.contains("theme-light");
      applyTheme(startingLight);

      themeBtn.addEventListener("click", function () {
        var nowLight = !document.body.classList.contains("theme-light");
        applyTheme(nowLight);
      });
    }

  });

})();