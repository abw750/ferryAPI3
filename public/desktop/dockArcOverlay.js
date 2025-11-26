// public/desktop/dockArcOverlay.js — Cannon dock arcs
console.log("[dockArcOverlay] loaded");

(function () {
  const ns = "http://www.w3.org/2000/svg";

  function elNS(tag, attrs) {
    const n = document.createElementNS(ns, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // Geometry: match ferryClock.js / faceRenderer
  const CX = 200;
  const CY = 200;
  const DOCK_ARC_THICKNESS = 8;
  const R_DOCK_UPPER = 174; // outer lane ring
  const R_DOCK_LOWER = 165; // inner lane ring

  // Color palette: match ferryClock.js
  const COLOR_STRONG_LTR = "#1c9560a7"; // BI → SEA
  const COLOR_STRONG_RTL = "#ff2121b9"; // SEA → BI
  const COLOR_DOT_LTR    = "#10b981";
  const COLOR_DOT_RTL    = "#ef4444";

  const COLORS = {
    ltr: { strong: COLOR_STRONG_LTR, light: COLOR_STRONG_LTR, dot: COLOR_DOT_LTR },
    rtl: { strong: COLOR_STRONG_RTL, light: COLOR_STRONG_RTL, dot: COLOR_DOT_RTL },
  };

  function laneDir(lane) {
    const d = (lane?.direction || "").toUpperCase();
    if (d === "WEST_TO_EAST") return "ltr";
    if (d === "EAST_TO_WEST") return "rtl";
    return null;
  }

  function describeArcPathLocal(cx, cy, r, startAngle, endAngle) {
    function polarToCartesianLocal(cx, cy, r, angleRad) {
      return {
        x: cx + r * Math.cos(angleRad),
        y: cy + r * Math.sin(angleRad),
      };
    }

    const start = polarToCartesianLocal(cx, cy, r, startAngle);
    const end   = polarToCartesianLocal(cx, cy, r, endAngle);

    let delta = endAngle - startAngle;
    while (delta < 0) delta += Math.PI * 2;
    while (delta > Math.PI * 2) delta -= Math.PI * 2;

    const largeArcFlag = delta > Math.PI ? 1 : 0;
    const sweepFlag = 1;

    return [
      "M", start.x, start.y,
      "A", r, r, 0, largeArcFlag, sweepFlag, end.x, end.y,
    ].join(" ");
  }

  function drawDockArcForLane(group, lane, laneKey, now) {
    if (!group || !lane) return;
    if (!lane.atDock) return;
    if (!lane.dockStartTime) return;

    const startDate = new Date(lane.dockStartTime);
    const startMs = startDate.getTime();
    if (!Number.isFinite(startMs)) return;

    const nowMs = now.getTime();
    const elapsedMs = nowMs - startMs;
    if (elapsedMs <= 0) return;

    const elapsedSeconds = elapsedMs / 1000;
    let frac = elapsedSeconds / 3600; // 0–3600s → 0–1
    if (frac <= 0) return;
    if (frac > 1) frac = 1;

    const radius = laneKey === "upper" ? R_DOCK_UPPER : R_DOCK_LOWER;

    // Anchor: minute hand at dockStartTime, local minutes + seconds
    const localMinutes = (startDate.getMinutes() + startDate.getSeconds() / 60) % 60;
    const startAngle = (Math.PI / 30) * localMinutes - Math.PI / 2;

    const spanAngle = frac * Math.PI * 2;
    const endAngle = startAngle + spanAngle;

    const dirKey = laneDir(lane);
    if (!dirKey) return;

    const scheme = dirKey === "rtl" ? COLORS.rtl : COLORS.ltr;
    const lowConfidence = !!lane.dockStartIsSynthetic || !!lane.isStale;
    const strokeColor = lowConfidence ? scheme.light : scheme.strong;

    if (frac >= 0.999) {
      const circle = elNS("circle", {
        cx: String(CX),
        cy: String(CY),
        r: String(radius),
        fill: "none",
        stroke: strokeColor,
        "stroke-width": String(DOCK_ARC_THICKNESS),
      });
      group.appendChild(circle);
    } else {
      const d = describeArcPathLocal(CX, CY, radius, startAngle, endAngle);
      const path = elNS("path", {
        d,
        fill: "none",
        stroke: strokeColor,
        "stroke-width": String(DOCK_ARC_THICKNESS),
        "stroke-linecap": "butt",
      });
      group.appendChild(path);
    }
  }

  /**
   * Main entry: draws dock arcs for upper / lower lanes.
   *
   * opts: {
   *   group:     <SVGGroupElement>, // #dock-arcs
   *   upperLane: state.lanes.upper,
   *   lowerLane: state.lanes.lower,
   *   now:       Date
   * }
   */
  function render(opts) {
    if (!opts || !opts.group || !opts.now) return;

    const g = opts.group;
    const upper = opts.upperLane || null;
    const lower = opts.lowerLane || null;
    const now = opts.now;

    if (upper) drawDockArcForLane(g, upper, "upper", now);
    if (lower) drawDockArcForLane(g, lower, "lower", now);
  }

  window.FerryDockArcOverlay = { render };
})();
