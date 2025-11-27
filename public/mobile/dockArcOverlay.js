// public/mobile/dockArcOverlay.js — Cannon dock arcs
console.log("[dockArcOverlay] loaded");

(function () {
  const ns = "http://www.w3.org/2000/svg";

  function elNS(tag, attrs) {
    const n = document.createElementNS(ns, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  // Geometry is supplied by ferryClock.js via window.FerryGeometry.


  // Color palette: use global FerryPalette from ferryClock.js
  function getColors() {
    const palette = window.FerryPalette;
    if (!palette) {
      throw new Error("[dockArcOverlay] FerryPalette is not defined");
    }
    return {
      ltr: { strong: palette.strongLtr, light: palette.strongLtr, dot: palette.dotLtr },
      rtl: { strong: palette.strongRtl, light: palette.strongRtl, dot: palette.dotRtl },
    };
  }

  function drawDockArcForLane(group, lane, laneKey, now, geom) {
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

    // Geometry: pull from FerryGeometry with safe fallbacks.
    const CX = geom && typeof geom.CX === "number" ? geom.CX : 200;
    const CY = geom && typeof geom.CY === "number" ? geom.CY : 200;

    const dockRadii = (geom && geom.dockRadii) || {};
    const radius =
      laneKey === "upper"
        ? (typeof dockRadii.upper === "number" ? dockRadii.upper : 175)
        : (typeof dockRadii.lower === "number" ? dockRadii.lower : 165);

    const dockArcThickness =
      geom && typeof geom.dockArcThickness === "number"
        ? geom.dockArcThickness
        : 8;

    const describeArcPath =
      geom && typeof geom.describeArcPath === "function"
        ? geom.describeArcPath
        : window.FerryDescribeArcPath;

    // Anchor: minute hand at dockStartTime, local minutes + seconds
    const localMinutes =
      (startDate.getMinutes() + startDate.getSeconds() / 60) % 60;
    const startAngle = (Math.PI / 30) * localMinutes - Math.PI / 2;

    const spanAngle = frac * Math.PI * 2;
    const endAngle = startAngle + spanAngle;

    const dirKey = window.FerryLaneDir ? window.FerryLaneDir(lane) : null;
    if (!dirKey) return;

    const COLORS = getColors();
    const scheme = dirKey === "rtl" ? COLORS.rtl : COLORS.ltr;

    // Stale/synthetic dock timing → visually degraded arc
    const staleForArc =
      !!lane.dockStartIsSynthetic ||
      !!lane.isStale;

    const baseOpacity = staleForArc ? 0.6 : 1.0;
    const strokeColor = staleForArc ? scheme.light : scheme.strong;

    if (frac >= 0.999) {
      // Full circle: 1h+ at dock
      const circle = elNS("circle", {
        cx: String(CX),
        cy: String(CY),
        r: String(radius),
        fill: "none",
        stroke: strokeColor,
        "stroke-width": String(dockArcThickness),
        opacity: String(baseOpacity),
      });
      group.appendChild(circle);
    } else if (typeof describeArcPath === "function") {
      // Partial arc
      const d = describeArcPath(CX, CY, radius, startAngle, endAngle);
      const path = elNS("path", {
        d,
        fill: "none",
        stroke: strokeColor,
        "stroke-width": String(dockArcThickness),
        "stroke-linecap": "butt",
        opacity: String(baseOpacity),
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
   *   now:       Date,
   *   geometry?: window.FerryGeometry
   * }
   */
  function render(opts) {
    if (!opts || !opts.group || !opts.now) return;

    const geom = opts.geometry || window.FerryGeometry || null;
    if (!geom) {
      console.warn("[dockArcOverlay] missing FerryGeometry; skipping arcs");
      return;
    }

    const g = opts.group;
    const upper = opts.upperLane || null;
    const lower = opts.lowerLane || null;
    const now = opts.now;

    if (upper) drawDockArcForLane(g, upper, "upper", now, geom);
    if (lower) drawDockArcForLane(g, lower, "lower", now, geom);
  }

  window.FerryDockArcOverlay = { render };
})();
