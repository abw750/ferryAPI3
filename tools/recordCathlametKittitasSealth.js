// tools/recordCathlametKittitasSealth.js
// Standalone recorder for Cathlamet, Kittitas, Sealth vessel snapshots.
// Calls WSDOT once per minute and writes JSONL to ./data/.

const fs = require("fs");
const path = require("path");
const https = require("https");

const API_KEY = process.env.WSDOT_API_KEY; // must be set in your environment
const BASE_URL = "https://www.wsdot.wa.gov/Ferries/API/Vessels/rest/vessellocations";

// how many samples and how far apart
const SAMPLE_COUNT = 240;        // number of polls
const INTERVAL_MS = 30_000;     // 30 seconds between polls

// ensure ./data exists
const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// filename based on start time
const startIso = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(dataDir, `Cathlamet_Kittitas_Sealth_${startIso}.jsonl`);

if (!API_KEY) {
  console.error("ERROR: WSDOT_API_KEY is not set in the environment.");
  process.exit(1);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, res => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`HTTP ${res.statusCode}`));
          res.resume();
          return;
        }

        let data = "";
        res.on("data", chunk => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      })
      .on("error", reject);
  });
}

async function pollOnce(index) {
  const t = new Date();
  const tIso = t.toISOString();

  const url = `${BASE_URL}?apiaccesscode=${encodeURIComponent(API_KEY)}`;

  console.log(`[${index + 1}/${SAMPLE_COUNT}] ${tIso} – fetching vessels...`);

  try {
    const raw = await fetchJson(url);

    if (!Array.isArray(raw)) {
      throw new Error("Unexpected payload shape (expected array)");
    }

    // Filter to Cathlamet, Kittitas, Sealth only
    const filtered = raw.filter(
      v => v && (v.VesselName === "Cathlamet" || v.VesselName === "Kittitas" || v.VesselName === "Sealth")
    );

    const record = {
      t: tIso,
      vessels: filtered,
    };

    fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");

    console.log(
      `  -> recorded ${filtered.length} rows for Cathlamet/Kittitas/Sealth`
    );
  } catch (err) {
    console.error(`  !!! error: ${err.message}`);
    const record = {
      t: tIso,
      error: err.message,
    };
    fs.appendFileSync(outFile, JSON.stringify(record) + "\n", "utf8");
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Writing JSONL output to: ${outFile}`);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    await pollOnce(i);
    if (i < SAMPLE_COUNT - 1) {
      await delay(INTERVAL_MS);
    }
  }
  console.log("Done.");
}

main().catch(err => {
  console.error("Fatal error in recorder:", err);
  process.exit(1);
});
