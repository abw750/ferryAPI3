// public/analogClock.js — clock-only scaffolding. No ferry visuals.
console.log("[analogClock] init, svg found:", !!document.getElementById("clockFace"));

(function initClock() {
    const SVG_ID = "clockFace";
    const svg = document.getElementById(SVG_ID);
    if (!svg) { document.addEventListener("DOMContentLoaded", initClock, { once: true }); return; }

    // --- clock hands (hour, minute, second) ---
    const HAND_COLOR = "#275dd2ff";        // hour + minute hands
    const SECOND_HAND_COLOR = "#ef4444"; // second hand
    const CENTER_DOT_COLOR = "#ff0000ff";  // center dot

    const hands = ensure(svg, "g", { id: "clock-hands" });

    const hourHand = ensure(hands, "line", {
        id: "hand-hour",
        x1: 200, y1: 200, x2: 200, y2: 105
    });
    hourHand.setAttribute(
        "style",
        `stroke:${HAND_COLOR};stroke-width:4;stroke-linecap:round`
    );

    const minuteHand = ensure(hands, "line", {
        id: "hand-minute",
        x1: 200, y1: 200, x2: 200, y2: 65
    });
    minuteHand.setAttribute(
        "style",
        `stroke:${HAND_COLOR};stroke-width:2.5;stroke-linecap:round`
    );

    const secondHand = ensure(hands, "line", {
        id: "hand-second",
        x1: 200, y1: 200, x2: 200, y2: 23
    });
    secondHand.setAttribute(
        "style",
        `stroke:${SECOND_HAND_COLOR};stroke-width:1.5;stroke-linecap:round`
    );

    // Center dot
    const centerDot = ensure(hands, "circle", {
        id: "clock-center",
        cx: 200, cy: 200, r: 4
    });
    centerDot.setAttribute("style", `fill:${CENTER_DOT_COLOR}`);

    function setRot(node, deg) {
        node.setAttribute("transform", `rotate(${deg} 200 200)`);
    }

    function tick() {
        const now = new Date();
        const s = now.getSeconds();
        const m = now.getMinutes();
        const h = now.getHours() % 12;

        const ha = (h + m / 60) * 30;
        const ma = (m + s / 60) * 6;

        const sub = Math.floor((now.getMilliseconds() / 1000) * 10);
        const sAdj = s + sub / 10;

        setRot(hourHand, ha);
        setRot(minuteHand, ma);
        setRot(secondHand, sAdj * 6);
    }

    tick();
    setInterval(tick, 100);

    function ensure(parent, tag, attrs) {
        const ns = "http://www.w3.org/2000/svg";
        let node = (attrs.id && parent.querySelector(`#${attrs.id}`)) || null;
        if (!node) node = document.createElementNS(ns, tag);
        for (const k in attrs) node.setAttribute(k, attrs[k]);
        if (!node.parentNode) parent.appendChild(node);
        return node;
    }
})();
