Live Demo:
(https://ferryapi3.onrender.com/)

FerryAPI3 is a real-time analog Puget Sound ferry route status display powered by data from the Washington State Ferries (WSDOT) APIs.

It renders vessel positions, direction of travel, time at dock, available car spots on the next vessel to sail, and transit status using Cannon-based rendering rules.

Features:
User-selectable route (persisting until next session)
Automatic fallback handling for stale or missing WSDOT data
Analog ferry clock UI with upper/lower lanes that represent vessel transit progress if underway (lanes) including
Vessel name, Accurate direction (arrow), progress visualisation (lanes) in growing color bar, growing from departed terminal.
Accurate time spent at-dock visualization (arcs)
Small donut indicators of the numbers of available car spots on next sailing from the terminal proximate to the donut visual (capacity pies)
Deterministic single-vessel behavior for routes with only one active ferry
Deterministic vessel updates whem a vessel change happens in any given day.

Supported Routes at those with data provided by the API, sourced from routeConfig.js, including:
Seattle ↔ Bainbridge Island
Pt. Defiance ↔ Tahlequah
Edmonds ↔ Kingston
Mukilteo ↔ Clinton
Port Townsend ↔ Coupeville
West Seattle ↔ Southworth
West Seattle ↔ Vashon
Southworth ↔ Vashon

Tech Stack:
Node + Express backend
WSDOT real-time API integrations
Vanilla JS + SVG front-end
Modular overlays for lanes, arcs, and capacity pies

Local Development:
npm install
node server.js
# visit http://localhost:8000

Known Notes:
WSDOT periodically omits vessel or capacity data; the app generates syntetic data, changes format to indicate synthetic data is being displayed
If omission persists for more than 20 minutes, the vessel/lane will disappear.when this occurs and eventually mirrors this behavior rather than inventing estimates.
Single-terminal routes (e.g., Route 1) report capacity for only one side—FerryClock3 uses per-terminal stale interpretation to avoid misleading visuals.
