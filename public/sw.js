// public/sw.js

const CACHE_NAME = "ferryclock-static-v1";
const ASSETS = [
  "/",
  "/mobile/",
  "/mobile/index.html",
  "/mobile/style.css",
  "/mobile/faceRenderer.js",
  "/mobile/analogClock.js",
  "/mobile/ferryClock.js",
  "/mobile/capacityOverlay.js",
  "/mobile/dockArcOverlay.js",
  "/mobile/laneOverlay.js"
  // You can add icons and other assets here as needed
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(ASSETS).catch(function (err) {
        // Do not fail install on cache errors; this worker is still usable
        console.warn("SW cache addAll error:", err);
      });
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) { return caches.delete(key); })
      );
    })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") {
    return;
  }

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) {
        return cached;
      }
      return fetch(req).catch(function () {
        // If both network and cache miss, just let it fail
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
