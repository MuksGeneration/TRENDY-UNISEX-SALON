// Cache-free service worker: keeps PWA installability while ensuring every request
// goes directly to the network and purges any legacy Workbox caches.
const swSelf = self as unknown as {
  skipWaiting: () => Promise<void>;
  clients: { claim: () => Promise<void> };
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
};

swSelf.addEventListener('install', (event) => {
  const e = event as { waitUntil?: (p: Promise<unknown>) => void };
  e.waitUntil?.(swSelf.skipWaiting());
});

swSelf.addEventListener('activate', (event) => {
  const e = event as { waitUntil?: (p: Promise<unknown>) => void };
  e.waitUntil?.(
    (async () => {
      if (typeof caches !== 'undefined') {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      await swSelf.clients.claim();
    })()
  );
});
