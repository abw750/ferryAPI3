const { fetchDailyScheduleRaw } = require("./wsdotClient");

async function run() {
  const now = new Date();
  const tripDateText = now.toISOString().slice(0, 10);

  try {
    const data = await fetchDailyScheduleRaw(15, tripDateText);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Schedule15 error:", err.message || err);
  }
}

run();
