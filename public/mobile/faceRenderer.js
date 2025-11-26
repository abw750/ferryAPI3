// public/mobile/faceRenderer.js — owns SVG layers only. No time. No ferries.
(function () {
  function init() {
    const SVG_ID = "clockFace";
    const svg = document.getElementById(SVG_ID);
    if (!svg) { setTimeout(init, 50); return; }

    // Ensure a single overlay root
    const overlay = ensure(svg, "g", { id: "clock-overlay" });

    // Two stable row groups for consumers
    const rowTop = ensure(overlay, "g", { id: "row-top" });
    const rowBot = ensure(overlay, "g", { id: "row-bot" });

    // Public accessor for engines
    window.getFaceLayers = function getFaceLayers() {
      return {
        overlay,
        top: rowTop,
        bottom: rowBot,
        clear() { rowTop.innerHTML = ""; rowBot.innerHTML = ""; }
      };
    };

    // ----- minute ticks + mid ring (static once) -----
    if (!svg.querySelector("#minute-face")) {
      const ns = "http://www.w3.org/2000/svg";
      const G = document.createElementNS(ns, "g");
      G.setAttribute("id", "minute-face"); // styling via CSS
      svg.appendChild(G);

      // mid + rim rings
      const C = { cx: 200, cy: 200 };

      // mid ring (keep current stroke width from CSS)
      const mid = document.createElementNS(ns, "circle");
      mid.setAttribute("cx", String(C.cx));
      mid.setAttribute("cy", String(C.cy));
      mid.setAttribute("r", "169");
      mid.setAttribute("fill", "none"); // prevent black dial fill
      G.appendChild(mid);

      // outer rim (at 178) - thicker than mid
      const outer = document.createElementNS(ns, "circle");
      outer.setAttribute("cx", String(C.cx));
      outer.setAttribute("cy", String(C.cy));
      outer.setAttribute("r", "178");
      outer.setAttribute("fill", "none");
      outer.setAttribute("stroke-width", "2");
      G.appendChild(outer);

      // inner rim (inside short ticks) - thicker than mid
      const inner = document.createElementNS(ns, "circle");
      inner.setAttribute("cx", String(C.cx));
      inner.setAttribute("cy", String(C.cy));
      inner.setAttribute("r", "160");
      inner.setAttribute("fill", "none");
      inner.setAttribute("stroke-width", "2");
      G.appendChild(inner);

      // hour numerals 1–12 inside inner rim
      const numeralRadius = 146; // slightly inside inner ring (r=160)
      for (let h = 1; h <= 12; h++) {
        const angle = (Math.PI / 6) * (h - 3); // 3 o'clock at 0 rad, 12 at -90°
        const x = C.cx + numeralRadius * Math.cos(angle);
        const y = C.cy + numeralRadius * Math.sin(angle);

        const text = document.createElementNS(ns, "text");
        text.setAttribute("x", String(x));
        text.setAttribute("y", String(y+2));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.setAttribute("font-size", "14");
        text.setAttribute("font-weight", "normal");
        text.textContent = String(h);
        G.appendChild(text);
      }

      // minute ticks: 60 spokes; every 5th is longer
      const rInner = 160;
      const rOuter = 178;
      const rOuterLong = 182;

      for (let i = 0; i < 60; i++) {
        const isFive = (i % 5) === 0;
        const a = (Math.PI / 30) * i - Math.PI / 2;

        const x1 = C.cx + (isFive ? (rInner - 4) : rInner) * Math.cos(a);
        const y1 = C.cy + (isFive ? (rInner - 4) : rInner) * Math.sin(a);
        const x2 = C.cx + (isFive ? rOuterLong : rOuter) * Math.cos(a);
        const y2 = C.cy + (isFive ? rOuterLong : rOuter) * Math.sin(a);

        const tick = document.createElementNS(ns, "line");
        tick.setAttribute("x1", String(x1));
        tick.setAttribute("y1", String(y1));
        tick.setAttribute("x2", String(x2));
        tick.setAttribute("y2", String(y2));
        G.appendChild(tick);
      }
      // outer minute numerals (5–60) just outside outer rim
      const minuteLabelRadius = 190; // outside rOuterLong=182, inside SVG edge
      for (let i = 0; i < 60; i++) {
        if (i % 5 !== 0) continue; // only 5-minute increments

        const value = (i === 0) ? 60 : i; // 0 minutes → "60" at top
        const a = (Math.PI / 30) * i - Math.PI / 2;

        const x = C.cx + minuteLabelRadius * Math.cos(a);
        const y = C.cy + minuteLabelRadius * Math.sin(a);

        const label = document.createElementNS(ns, "text");
        label.setAttribute("x", String(x));
        label.setAttribute("y", String(y+1));
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.setAttribute("font-size", "10");
        label.textContent = String(value);
        G.appendChild(label);
      }
  
      // Time zone label (PST/PDT) under 12 o'clock.
      let tzLabel = svg.querySelector("#clock-tz-label");
      if (!tzLabel) {
        const SVG_NS = "http://www.w3.org/2000/svg";
        tzLabel = document.createElementNS(SVG_NS, "text");
        tzLabel.setAttribute("id", "clock-tz-label");
        tzLabel.setAttribute("x", String(C.cx));           // center horizontally
        tzLabel.setAttribute("y", String(C.cy - 130));     // under 12, relative to center
        tzLabel.setAttribute("text-anchor", "middle");
        tzLabel.setAttribute("dominant-baseline", "middle");
        tzLabel.setAttribute("font-size", "8");
        tzLabel.setAttribute("fill", "#9ca3af");
        tzLabel.textContent = ""; // analogClock.js will set PST/PDT
        svg.appendChild(tzLabel);
      }

      // Static attribution text just below the center clock position.
      let attribution = svg.querySelector("#clock-attribution");
      if (!attribution) {
        attribution = document.createElementNS(ns, "text");
        attribution.setAttribute("id", "clock-attribution");
        attribution.setAttribute("x", "200");    // center of 400x400 viewBox
        attribution.setAttribute("y", "210");    // just above bottom edge / 6 o'clock
        attribution.setAttribute("text-anchor", "middle");
        attribution.setAttribute("font-size", "6"); // small text
        attribution.setAttribute("font-style", "italic");
        attribution.setAttribute("fill", "#9ca3af");
        attribution.textContent = "Ferry data from WSDOT API";
        svg.appendChild(attribution);
      }
    }
  }

  function ensure(parent, tag, attrs) {
    const ns = "http://www.w3.org/2000/svg";
    const id = attrs && attrs.id;
    let node = id ? parent.querySelector(`#${id}`) : null;
    if (!node) node = document.createElementNS(ns, tag);
    if (attrs) for (const k in attrs) node.setAttribute(k, attrs[k]);
    if (!node.parentNode) parent.appendChild(node);
    return node;
  }

  // Run after DOM is ready so #clockFace exists.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
