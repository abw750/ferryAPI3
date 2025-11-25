// backend/dumpTerminals.js
//
// Dump TerminalID + TerminalName from terminalsailingspace.
// This shows the authoritative strings WSDOT uses, which must
// match routeConfig.js terminalNameWest/East (case-insensitive).

const { fetchTerminalSpaces } = require("./wsdotClient");

async function run() {
  try {
    const rows = await fetchTerminalSpaces();

    console.log("=== Terminals from terminalsailingspace ===");
    console.log("(TerminalID)\t(TerminalName)");

    for (const row of rows) {
      if (!row) continue;

      const id = row.TerminalID;
      const name = row.TerminalName;

      if (id == null || name == null) continue;

      console.log(`${id}\t${String(name)}`);
    }
  } catch (err) {
    console.error("Error fetching terminalsailingspace:", err.message || err);
  }
}

run();
