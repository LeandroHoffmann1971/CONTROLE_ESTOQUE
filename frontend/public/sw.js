const CACHE_NAME = "despensa-react-v1";
const APP_FILES = ["/", "/index.html"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(async cache => {
    await Promise.all(APP_FILES.map(async file => {
      const response = await fetch(new Request(file, { cache: "reload" }));
      if (!response.ok)
        throw new Error(`Não foi possível atualizar o arquivo ${file}.`);
      await cache.put(file, response);
    }));
  }));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
  )));
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.startsWith("/api/"))
    return;

  if (request.mode === "navigate" || APP_FILES.includes(url.pathname)) {
    event.respondWith(fetch(request, { cache: "reload" }).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      throw new Error(`Nenhuma versão local disponível para ${url.pathname}.`);
    }));
    return;
  }

  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
    return response;
  })));
});
