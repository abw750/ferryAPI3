// public/capacityOverlay.js — capacity pies (Cannon semantics)
console.log("[capacityOverlay] loaded");

(function () {
  const ns = "http://www.w3.org/2000/svg";

  function elNS(tag, attrs) {
    const n = document.createElementNS(ns, tag);
    if (attrs) for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  /**
   * Main entry: draws WEST / EAST capacity pies exactly as ferryClock.js did.
   *
   * opts: {
   *   group:  <SVGGroupElement>  // #capacity-pies
   *   state:  <dot-state object>
   * }
   */
  function render(opts) {
    if (!opts || !opts.group || !opts.state) return;
    drawCapacityPies(opts.group, opts.state);
  }

  // --- copied logic (identical behavior) ------------------------------------

  function drawCapacityPies(group, state) {
    if (!group || !state) return;
    const cap = state.capacity || null;
    if (!cap) return;

    const maxW = cap.westMaxAuto;
    const availW = cap.westAvailAuto;
    const maxE = cap.eastMaxAuto;
    const availE = cap.eastAvailAuto;

    if ((maxW == null || maxW <= 0) && (maxE == null || maxE <= 0)) return;

    const capacityStaleGlobal = !!(state.meta && state.meta.capacityStale);

    const westHasReal = maxW != null && maxW > 0;
    const eastHasReal = maxE != null && maxE > 0;

    // Side-specific “low confidence” flags:
    // - If only one side has real capacity data, we treat that side as NON-stale
    //   even when capacityStaleGlobal is true (Route 1 case).
    // - If both sides have real data and capacityStaleGlobal is true, both sides
    //   get the low-confidence (light) treatment.
    const capacityStaleWest = capacityStaleGlobal && westHasReal && eastHasReal;
    const capacityStaleEast = capacityStaleGlobal && westHasReal && eastHasReal;

    const rOuter = 20;
    const strokeWidth = 6;
    const rInner = rOuter - strokeWidth;

    // Dial geometry
    const CX = 200;
    const CY = 200;
    const BAR_W = 150;
    const offset = BAR_W / 2 + 50;
    const xWestLabel = CX - offset;
    const xEastLabel = CX + offset;
    const yMid = CY;

    const xWestPie = xWestLabel + (CX - xWestLabel) / 3;
    const xEastPie = xEastLabel + (CX - xEastLabel) / 3;

    drawOneCapacityPie(group, {
      cx: xWestPie,
      cy: yMid,
      rOuter,
      rInner,
      avail: availW,
      max: maxW,
      side: "west",
      capacityStale: capacityStaleWest,
    });

    drawOneCapacityPie(group, {
      cx: xEastPie,
      cy: yMid,
      rOuter,
      rInner,
      avail: availE,
      max: maxE,
      side: "east",
      capacityStale: capacityStaleEast,
    });
  }

    function drawOneCapacityPie(group, opts) {
    const {
      cx, cy,
      rOuter,
      rInner,
      avail,
      max,
      side,
      capacityStale,
    } = opts;

    if (max == null || max <= 0) return;
    if (avail == null || avail < 0) return;

    let frac = avail / max;
    if (!Number.isFinite(frac)) return;
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;

    // color mapping must match ferryClock.js COLORS.ltr / COLORS.rtl
    const COLOR_STRONG_LTR = "#1c9560a7";
    const COLOR_STRONG_RTL = "#ff2121b9";
    const COLOR_DOT_LTR    = "#10b981";
    const COLOR_DOT_RTL    = "#ef4444";
    const COLOR_TRACK      = "#fdfdfda0";

    const scheme = side === "west"
      ? { strong: COLOR_STRONG_LTR, light: COLOR_STRONG_LTR, dot: COLOR_DOT_LTR }
      : { strong: COLOR_STRONG_RTL, light: COLOR_STRONG_RTL, dot: COLOR_DOT_RTL };

    const low = !!capacityStale;
    const strokeColor = low ? scheme.light : scheme.strong;
    const baseOpacity = low ? 0.6 : 1.0;
    const thickness = rOuter - rInner;
    const rMid = rInner + thickness / 2;

    // Grey track (always visible)
    const track = elNS("circle", {
      cx, cy,
      r: rMid,
      fill: "none",
      stroke: COLOR_TRACK,
      "stroke-width": thickness,
      opacity: baseOpacity,
    });
    group.appendChild(track);

    // Fraction arc
    if (frac > 0) {
      if (frac >= 0.999) {
        const ring = elNS("circle", {
          cx, cy,
          r: rMid,
          fill: "none",
          stroke: strokeColor,
          "stroke-width": thickness,
          opacity: baseOpacity,
        });
        group.appendChild(ring);
      } else {
        // 12 o’clock start, clockwise grow
        const startAngle = -Math.PI / 2;
        const endAngle = startAngle + frac * Math.PI * 2;

        // Prefer shared helper from ferryClock.js; fall back to local copy
        const arcFn = (typeof window.FerryDescribeArcPath === "function")
          ? window.FerryDescribeArcPath
          : describeArcPathLocal;

        const d = arcFn(cx, cy, rMid, startAngle, endAngle);

        const path = elNS("path", {
          d,
          fill: "none",
          stroke: strokeColor,
          "stroke-width": thickness,
          "stroke-linecap": "butt",
          opacity: baseOpacity,
        });
        group.appendChild(path);
      }
    }

    // inner disk
    const isLightTheme = document.body.classList.contains("theme-light");
    const innerFill = isLightTheme ? "#ffffff" : "#020617";

    const inner = elNS("circle", {
      cx, cy,
      r: rInner - 1,
      fill: innerFill,
      opacity: 1,
    });
    group.appendChild(inner);


    // text
    const label = elNS("text", {
      x: cx,
      y: cy + 1,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "font-size": "10",
      fill: "#111827",
      opacity: baseOpacity,
    });
    label.textContent = String(Math.round(avail));
    group.appendChild(label);
  }

  // Local fallback, identical geometry to ferryClock.js describeArcPath
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

  // export
  window.FerryCapacityOverlay = { render };
})();
