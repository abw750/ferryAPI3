// public/mobile/analogClock.js — clock-only scaffolding. No ferry visuals.
console.log("[analogClock] init, svg found:", !!document.getElementById("clockFace"));

(function initClock() {
    const SVG_ID = "clockFace";
    const svg = document.getElementById(SVG_ID);
    if (!svg) { document.addEventListener("DOMContentLoaded", initClock, { once: true }); return; }

    // --- clock hands (hour, minute, second) ---
    const HAND_COLOR = "#636c80ff";        // hour + minute hands
    const SECOND_HAND_COLOR = "#747474ff"; // second hand
    const CENTER_DOT_COLOR = "#525252ff";  // center dot

    const hands = ensure(svg, "g", { id: "clock-hands" });

    // Keep hour/minute hands under the ferry overlay layers.
    const overlay = svg.querySelector("#clock-overlay");
    if (overlay && hands.nextSibling !== overlay) {
    svg.insertBefore(hands, overlay);
    }

    const hourHand = ensure(hands, "line", {
        id: "hand-hour",
        x1: 200, y1: 200, x2: 200, y2: 90
    });
    hourHand.setAttribute(
        "style",
        `stroke:${HAND_COLOR};stroke-width:4;stroke-linecap:round`
    );

    const minuteHand = ensure(hands, "line", {
        id: "hand-minute",
        x1: 200, y1: 200, x2: 200, y2: 60
    });
    minuteHand.setAttribute(
        "style",
        `stroke:${HAND_COLOR};stroke-width:2.5;stroke-linecap:round`
    );

    // Second hand is independent of #clock-hands so it can sit above overlays.
    const secondHand = document.createElementNS("http://www.w3.org/2000/svg", "line");
    secondHand.setAttribute("id", "hand-second");
    secondHand.setAttribute("x1", "200");
    secondHand.setAttribute("y1", "200");
    secondHand.setAttribute("x2", "200");
    secondHand.setAttribute("y2", "23");
    secondHand.setAttribute(
        "style",
        `stroke:${SECOND_HAND_COLOR};stroke-width:1.5;stroke-linecap:round`
    );
    // Append once now; we will keep it last on every tick.
    svg.appendChild(secondHand);


    // Center dot (lives at root so it can sit above the second hand)
    const centerDot = ensure(svg, "circle", {
        id: "clock-center",
        cx: 200, cy: 200, r: 3
    });
    centerDot.setAttribute("style", `fill:${CENTER_DOT_COLOR}`);

    function setRot(node, deg) {
        node.setAttribute("transform", `rotate(${deg} 200 200)`);
    }
    // Return current time in Seattle (America/Los_Angeles), independent of client time zone.
    function getSeattleTimeParts() {
        const now = new Date();

        const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            hour12: false,
        });

        const parts = fmt.formatToParts(now);
        let h = 0, m = 0, s = 0;
        for (const p of parts) {
            if (p.type === "hour") h = parseInt(p.value, 10);
            else if (p.type === "minute") m = parseInt(p.value, 10);
            else if (p.type === "second") s = parseInt(p.value, 10);
        }

        // Milliseconds are the same globally; we can use local ms for smooth second hand.
        const ms = now.getMilliseconds();
        return { h, m, s, ms };
    }

    // Return current Seattle time zone abbreviation (e.g., "PST" or "PDT").
    function getSeattleZoneAbbrev() {
        const now = new Date();
        const fmt = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Los_Angeles",
            timeZoneName: "short",
            hour: "numeric"
        });

        const parts = fmt.formatToParts(now);
        for (const p of parts) {
            if (p.type === "timeZoneName") {
                // Typically returns "PST" or "PDT".
                return p.value;
            }
        }
        return "";
    }


    function tick() {
        const { h, m, s, ms } = getSeattleTimeParts();

        const hour12 = h % 12;

        const ha = (hour12 + m / 60) * 30;
        const ma = (m + s / 60) * 6;

        const sub = Math.floor((ms / 1000) * 10);
        const sAdj = s + sub / 10;

        setRot(hourHand, ha);
        setRot(minuteHand, ma);
        setRot(secondHand, sAdj * 6);

        // Update time zone label (PST/PDT) under 12 o'clock, if present.
        var tzNode = document.getElementById("clock-tz-label");
        if (tzNode) {
            const tz = getSeattleZoneAbbrev();
            // Show only "PST" or "PDT" (Intl may sometimes return "GMT-8" in odd locales).
            tzNode.textContent = (tz === "PST" || tz === "PDT") ? tz : tz;
        }

        // Keep the second hand just under the center dot on every tick.
        const svgNode = secondHand.ownerSVGElement;
        if (svgNode) {
            // Center dot should always be topmost
            if (centerDot && svgNode.lastChild !== centerDot) {
                svgNode.appendChild(centerDot);
            }
            // Second hand should sit directly under the center dot
            if (centerDot && centerDot.previousSibling !== secondHand) {
                svgNode.insertBefore(secondHand, centerDot);
            }
        }
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
