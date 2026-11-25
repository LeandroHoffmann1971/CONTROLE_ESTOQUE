const CACHE_NAME = "despensa-react-v2";
const APP_FILES = ["/", "/index.html"];

async function cacheResponse(request, response) {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (error) {
    console.warn("Não foi possível atualizar o cache offline.", error);
  }
}

self.addEventListener("install", event => {
  event.waitUntil(Promise.all([
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.all(APP_FILES.map(async file => {
        const response = await fetch(new Request(file, { cache: "reload" }));
        if (!response.ok)
          throw new Error(`Não foi possível atualizar o arquivo ${file}.`);
        await cache.put(file, response);
      }));
    }),
    self.skipWaiting()
  ]));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("despensa-react-") && key !== CACHE_NAME)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin)
    return;

  const isApiRequest = url.pathname === "/api" || url.pathname.startsWith("/api/");
  if (isApiRequest) {
    if (request.method !== "GET") {
      event.respondWith(fetch(request, { cache: "no-store" }));
      return;
    }

    const mayUseOfflineCache = !request.headers.has("authorization");
    event.respondWith(fetch(request, { cache: "no-store" }).then(async response => {
      if (mayUseOfflineCache && response.ok)
        await cacheResponse(request, response);
      return response;
    }).catch(async error => {
      if (mayUseOfflineCache) {
        const cached = await caches.match(request);
        if (cached) return cached;
      }
      throw error;
    }));
    return;
  }

  if (request.method !== "GET")
    return;

  if (request.mode === "navigate" || APP_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: "no-store" }).then(async response => {
      if (response.ok)
        await cacheResponse(request, response);
      return response;
    }).catch(async error => {
      const cached = await caches.match(request) || await caches.match("/index.html");
      if (cached) return cached;
      throw error;
    }));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok)
      caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
