// public/desktop/laneOverlay.js — lane bars + arrows + dots (Cannon semantics)

(function () {
  // Geometry + helper functions injected from ferryClock.js
  let helpers = null;

  const ns = "http://www.w3.org/2000/svg";
  const STROKE_CAP = "round";

  function elNS(tag, attrs) {
    const n = document.createElementNS(ns, tag);
    if (attrs) {
      for (const k in attrs) {
        n.setAttribute(k, attrs[k]);
      }
    }
    return n;
  }

  function line(x1, y1, x2, y2, stroke, w) {
    const n = elNS("line", { x1, y1, x2, y2 });
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
      "stroke-linecap": STROKE_CAP,
    });
  }

  function addText(group, text, x, y, opts = {}) {
    const t = elNS("text", {
      x: String(x),
      y: String(y),
      "text-anchor": opts.anchor || "middle",
      fill: opts.fill || "#111827",
      "font-size": opts.fontSize || "12",
    });
    t.textContent = text;
    group.appendChild(t);
  }

  /**
   * Inject shared geometry and helper functions so this module does not
   * depend on guessing globals.
   *
   * Expected shape (from ferryClock.js):
   * {
   *   CX, CY,
   *   laneDir,
   *   isUnderway,
   *   barRect,
   *   circleDot,
   *   addShipIcon,
   *   formatClockLabel,
   *   COLORS,
   *   BAR_W,
   *   BAR_THICKNESS,
   *   BAR_Y_OFFSET,
   *   LABEL_GAP
   * }
   */
  function injectHelpers(h) {
    helpers = h || null;
  }

  function render(opts) {
    if (!opts || !helpers) return;

    const {
      topGroup,
      bottomGroup,
      upperLane,
      lowerLane,
      // now, CX, CY also passed, but we use injected CX/CY
    } = opts;

    const {
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
    } = helpers;

    if (!topGroup && !bottomGroup) return;

    function drawLaneRowModule(group, lane, yRow) {
      if (!group || !lane) return;

      const dirKey = laneDir(lane);
      const underway = isUnderway(lane);
      const scheme = dirKey === "rtl" ? COLORS.rtl : COLORS.ltr;
      const barWidth = BAR_W;
      const xL = CX - barWidth / 2;
      const xR = CX + barWidth / 2;
      const barY = (yRow < CY)
        ? (yRow + BAR_Y_OFFSET)
        : (yRow - BAR_Y_OFFSET);

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

      // ---- transit bar + moving dot (dotPosition) ----
      if (dirKey) {
        // grey track
        const trackRect = barRect(xL, xR, barY, BAR_THICKNESS, COLORS.track);
        group.appendChild(trackRect);

        let pos = lane.dotPosition;
        if (typeof pos !== "number" || !isFinite(pos)) pos = 0;
        pos = Math.max(0, Math.min(1, pos));

        let frac;
        if (dirKey === "rtl") {
          frac = 1 - pos;
        } else {
          frac = pos;
        }

        const xp = xL + frac * (xR - xL);

        if (underway) {
          // colored segment
          if (dirKey === "ltr") {
            group.appendChild(
              barRect(xL, xp, barY, BAR_THICKNESS, scheme.strong)
            );
          } else {
            group.appendChild(
              barRect(xR, xp, barY, BAR_THICKNESS, scheme.strong)
            );
          }

          // moving dot + ship icon
          group.appendChild(circleDot(xp, barY, 5.5, scheme.dot));
          addShipIcon(group, xp, barY);
        } else {
          // docked: dot at origin side
          const originIsWest = dirKey === "ltr";
          const originX = originIsWest ? xL : xR;
          group.appendChild(circleDot(originX, barY, 5.5, scheme.dot));
          addShipIcon(group, originX, barY);
        }

        // ---- labels (sched vs ETA) ----
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
            fill: "#111",
          });
        } else if (underway && eta) {
          addText(group, eta, destX, labelY, {
            anchor: destAnchor,
            fontSize: "10",
            fill: "#111",
          });
        }
      }

      // ---- vessel name ----
      const name = (lane.vesselName && String(lane.vesselName).trim()) || "—";
      const nameY = (yRow >= CY) ? (yRow - 12) : (yRow + 20);
      addText(group, name, CX, nameY, {
        fontSize: "12",
        fill: "#222",
      });
    }

    // Upper + lower lanes, same y positions as ferryClock
    if (upperLane && topGroup) {
      drawLaneRowModule(topGroup, upperLane, 95);
    }
    if (lowerLane && bottomGroup) {
      drawLaneRowModule(bottomGroup, lowerLane, 305);
    }

    // Sentinel: we successfully rendered something for this cycle.
    window.__LANE_OVERLAY_OK__ = true;
  }

  window.FerryLaneOverlay = {
    injectHelpers,
    render,
  };
})();
