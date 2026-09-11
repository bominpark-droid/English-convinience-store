/* 영어 편의점 — 오프라인 담당 (서비스 워커: 화면 파일을 기기에 저장해 두는 작은 프로그램)
   인터넷이 끊겨도 앱이 열리게 한다.
   방식: 저장해 둔 것을 먼저 보여주고(빠르고 오프라인 OK), 뒤에서 새 판을 받아 다음에 반영한다.
   ※ 서버(앱스스크립트)로 보내는 저장·로그인 요청은 건드리지 않는다. */
const CACHE = "ecvs-v1";
const SHELL = ["./", "./index.html", "./quest.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map(u => c.add(u)));   /* 하나 실패해도 나머지는 저장 */
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                       /* 저장 요청(POST)은 손대지 않는다 */
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.hostname.indexOf("script.google") >= 0) return; /* 서버는 언제나 실시간으로 */
  const mine = (url.origin === location.origin);
  const font = (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com");
  if (!mine && !font) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(net); return hit; }            /* 저장해 둔 것 먼저 */
    const res = await net;
    if (res) return res;
    const fb = await cache.match("./index.html");          /* 아무것도 없으면 첫 화면이라도 */
    return fb || new Response("오프라인이라 열 수 없어요", {
      status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
  })());
});
