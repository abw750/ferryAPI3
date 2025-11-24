// public/ferryClock.js — FerryClock3 analog overlay scaffold (with debug logging).
console.log("[ferryClock] loaded");

(function () {
  const REFRESH_MS = 10_000;
  let currentRouteId = null;
  let refreshTimerId = null;

  // --- clock geometry ---
  const CX = 200;
  const CY = 200;

  // color palette
  const COLOR_STRONG_LTR = "#1c9560a7"; // BI → SEA transit segment (semi transparent)
  const COLOR_STRONG_RTL = "#ff2121b9"; // SEA → BI transit segment (semi transparent)
  const COLOR_TRACK       = "#e5e7eba0"; // grey track (semi transparent)

  // Opaque dot colors, aligned with CSS lane-dot direction palette
  const COLOR_DOT_LTR   = "#10b981"; // WEST → EAST dot
  const COLOR_DOT_RTL   = "#ef4444"; // EAST → WEST dot

  const COLORS = {
    ltr:  { strong: COLOR_STRONG_LTR, light: COLOR_STRONG_LTR, dot: COLOR_DOT_LTR },
    rtl:  { strong: COLOR_STRONG_RTL, light: COLOR_STRONG_RTL, dot: COLOR_DOT_RTL },
    track: COLOR_TRACK,
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
  const R_DOCK_UPPER = 174;       // outer lane: midpoint of 160–178 band
  const R_DOCK_LOWER = 165;       // inner lane: midpoint above numerals at ~148

  // ---------- entry point ----------
  if (document.readyState === "loading") {
    console.log("[ferryClock] document still loading, waiting for DOMContentLoaded");
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    console.log("[ferryClock] document readyState =", document.readyState, "→ starting immediately");
    start();
  }

  async function start() {
    console.log("[ferryClock] start() called");

    const layers = await waitForFaceLayers();
    if (!layers) {
      console.warn("[ferryClock] getFaceLayers() not available after wait; aborting overlay.");
      return;
    }
    console.log("[ferryClock] got face layers:", layers);

    try {
      console.log("[ferryClock] fetching routes from /api/routes");
      const routes = await fetchRoutes();
      console.log("[ferryClock] routes payload:", routes);

      if (!routes || !routes.length) {
        console.warn("[ferryClock] no routes available from /api/routes");
        drawDebug(layers, "NO ROUTES");
        return;
      }

      // Same behavior as dotApp for now: pick the first route.
      currentRouteId = routes[0].routeId;
      console.log("[ferryClock] using routeId:", currentRouteId);

      await refreshDotState(layers);
      refreshTimerId = setInterval(() => refreshDotState(layers), REFRESH_MS);
    } catch (err) {
      console.error("[ferryClock] init error:", err);
      drawDebug(layers, "INIT ERROR");
    }
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
    if (currentRouteId == null) {
      console.warn("[ferryClock] no routeId selected yet");
      drawDebug(layers, "NO ROUTE");
      return;
    }

    const url = `/api/dot-state?routeId=${encodeURIComponent(currentRouteId)}`;
    console.log("[ferryClock] fetching dot-state:", url);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error("Dot API failed: HTTP " + res.status);
      }
      const state = await res.json();
      console.log("[ferryClock] dot-state payload:", state);

      renderAnalogOverlay(state, layers);
    } catch (err) {
      console.error("[ferryClock] refreshDotState error:", err);
      drawDebug(layers, "STATE ERROR");
    }
  }

  // ---------- overlay rendering ----------
  function renderAnalogOverlay(state, layers) {
    console.log("[ferryClock] renderAnalogOverlay()");

    layers.clear();

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
      const img = elNS("image", {
        href: ICON_SRC,
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

    const upperLane = state.lanes.upper || null;
    const lowerLane = state.lanes.lower || null;

    if (!upperLane && !lowerLane) {
      console.warn("[ferryClock] no upper/lower lanes in state; drawing DEBUG only");
      addText(layers.top, "NO LANES", CX, CY);
      return;
    }

    const route = state.route || {};
    const terminalIdWest = route.terminalIdWest;
    const terminalIdEast = route.terminalIdEast;

    console.log("[ferryClock] lanes:", { upperLane, lowerLane, terminalIdWest, terminalIdEast });

// Dock arcs: outer ring for upper lane, inner ring for lower lane
function renderDockArcOverlay(group, upperLane, lowerLane, now) {
  if (!group) return;

  if (window.FerryDockArcOverlay &&
      typeof window.FerryDockArcOverlay.render === "function") {
    try {
      window.FerryDockArcOverlay.render({
        group,
        upperLane,
        lowerLane,
        now,
      });
    } catch (err) {
      console.error("[ferryClock] FerryDockArcOverlay.render error:", err);
    }
  }

  // Fallback to the original implementation in case the module is missing
  // or fails. This restores previous behavior for now.
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
          "font-weight": "bold",
          "font-size": "12",
          fill: "#111",
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
          "font-weight": "bold",
          "font-size": "12",
          fill: "#111",
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
      const isTop = yRow < CY;

      // ---- direction arrow on 12–6 axis (same geometry as FerryAPI2) ----
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
          if (!underway) group.appendChild(circleDot(axL, y0, 2, arrowColor));
        } else {
          group.appendChild(arrowHead(axL, y0, Math.PI, arrowColor, 3, head));
          if (!underway) group.appendChild(circleDot(axR, y0, 2, arrowColor));
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
          // docked: dot at origin side, showing next-transit direction color
          const originIsWest = dirKey === "ltr";
          const originX = originIsWest ? xL : xR;
          group.appendChild(circleDot(originX, barY, 5.5, scheme.dot));
          addShipIcon(group, originX, barY);
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

      // ---- vessel name (same placement as FerryAPI2) ----
      const name = (lane.vesselName && String(lane.vesselName).trim()) || "—";
      const nameY = (yRow >= CY) ? (yRow - 12) : (yRow + 20);
      addText(group, name, CX, nameY, {
        fontSize: "12",
        fill: "#222"
      });
    }
    function drawLaneRow(group, lane, yRow) {
      if (!lane) return;
      const dirKey = laneDir(lane);
      const underway = isUnderway(lane);
      const scheme = dirKey === "rtl" ? COLORS.rtl : COLORS.ltr;
      const barWidth = BAR_W;
      const xL = CX - barWidth / 2;
      const xR = CX + barWidth / 2;
      const barY = (yRow < CY) ? (yRow + BAR_Y_OFFSET) : (yRow - BAR_Y_OFFSET);
      const isTop = yRow < CY;

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
          if (!underway) group.appendChild(circleDot(axL, y0, 2, arrowColor));
        } else {
          group.appendChild(arrowHead(axL, y0, Math.PI, arrowColor, 3, head));
          if (!underway) group.appendChild(circleDot(axR, y0, 2, arrowColor));
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
          // docked: dot at origin side, showing next-transit direction color
          const originIsWest = dirKey === "ltr";
          const originX = originIsWest ? xL : xR;
          group.appendChild(circleDot(originX, barY, 5.5, scheme.dot));
          addShipIcon(group, originX, barY);
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
      // If the module signaled success, skip fallback to avoid double-drawing.
      if (window.__LANE_OVERLAY_OK__ === true) {
        return;
      }

      // Fallback / baseline: original implementation.
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
        console.log("[ferryClock] getFaceLayers() already present");
        return resolve(window.getFaceLayers());
      }

      let attempts = 0;
      const maxAttempts = 50;
      console.log("[ferryClock] waiting for getFaceLayers() ...");
      const iv = setInterval(() => {
        attempts++;
        if (typeof window.getFaceLayers === "function") {
          clearInterval(iv);
          console.log("[ferryClock] getFaceLayers() became available after", attempts, "checks");
          resolve(window.getFaceLayers());
        } else if (attempts >= maxAttempts) {
          clearInterval(iv);
          console.warn("[ferryClock] getFaceLayers() never appeared after", attempts, "checks");
          resolve(null);
        }
      }, 100);
    });
  }
})();