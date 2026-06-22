/* 王老师的英语课 · MYSKME 课堂记分 — Service Worker
   目标：装到手机主屏后离线也能打开记分；联网时数据(data.json)总取最新。
   策略：
     · 应用外壳(index.html / manifest / 图标)：cache-first(秒开、离线可用)，后台顺手更新。
     · 数据 data.json：network-first(联网拿最新)，断网回退到上次缓存。
   换版本号即可让所有人下次打开时清旧缓存、拉新外壳。 */
const VERSION = "v3";
const SHELL = "myskme-shell-" + VERSION;
const DATA  = "myskme-data-" + VERSION;
const SHELL_ASSETS = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  // 预缓存外壳；逐个尝试，缺某个图标也不致整体失败
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.allSettled(SHELL_ASSETS.map(u => c.add(new Request(u, { cache: "reload" }))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== DATA).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 第三方请求不拦截

  // 数据 + 页面外壳(导航/index.html)：network-first，断网才回退缓存
  // —— 这样管理员发版后，联网用户一打开就拿到最新功能，而不是下次才生效
  const isNav = req.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith("/index.html");
  const isData = url.pathname.endsWith("/data.json");
  if (isNav || isData) {
    const bucket = isData ? DATA : SHELL;
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh && fresh.ok) { const c = await caches.open(bucket); c.put(req, fresh.clone()); }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req) || await caches.match("./index.html");
        return cached || new Response(isData ? '{"_offline":true}' : "离线且无缓存", { headers: { "Content-Type": isData ? "application/json" : "text/plain" } });
      }
    })());
    return;
  }

  // 静态资源(图标/manifest)：cache-first，后台刷新(stale-while-revalidate)
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res && res.ok && res.type === "basic") { caches.open(SHELL).then(c => c.put(req, res.clone())); }
      return res;
    }).catch(() => null);
    return cached || (await network) || caches.match("./index.html");
  })());
});
