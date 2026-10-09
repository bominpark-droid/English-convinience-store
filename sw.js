/* 영어 편의점 — 오프라인 담당 (서비스 워커: 화면 파일을 기기에 저장해 두는 작은 프로그램)
   인터넷이 끊겨도 앱이 열리게 한다.
   ※ 서버(앱스스크립트)로 보내는 저장·로그인 요청은 건드리지 않는다.

   방식 (2026-10-09 바꿈 — 대표 신고 「앱을 껐다 켜도 새로 고친 게 안 보인다」):
   · 화면 파일(index.html · quest.html) = 인터넷 먼저. 3초 안에 못 받으면 저장해 둔 것.
     예전엔 「저장한 것 먼저, 새 판은 뒤에서」라 고친 게 한 번 더 열어야 보였고,
     뒤에서 받을 때도 브라우저 캐시(깃허브 페이지는 10분)를 거쳐 옛 판을 또 받곤 했다.
   · 새 판을 받을 때는 브라우저 캐시를 건너뛰고 서버에 확인한다(cache: "no-cache" / "reload").
   · 글꼴·아이콘·소리 같은 나머지 = 예전처럼 저장한 것 먼저, 뒤에서 새로 받기. */
const CACHE = "ecvs-v1";
const SHELL = ["./", "./index.html", "./quest.html", "./manifest.json"];
const PAGE_WAIT = 3000;   /* 화면 파일을 인터넷에서 기다리는 시간(ms). 넘으면 저장해 둔 것을 보여 준다 */

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* 브라우저 캐시를 건너뛰고 서버에서 바로 받아 저장 — 옛 판이 끼어들지 않게 */
    await Promise.allSettled(SHELL.map(u => c.add(new Request(u, { cache: "reload" }))));   /* 하나 실패해도 나머지는 저장 */
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE && k !== "ecvs-tts")   /* ecvs-tts = 원어민 음성 저장소, 지우지 않는다 */
                         .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isPage(req, url) {
  return req.mode === "navigate" || /\.html$/.test(url.pathname) || url.pathname.endsWith("/");
}

/* 화면 파일: 인터넷 먼저 (브라우저 캐시 건너뜀) → 3초 넘거나 끊겼으면 저장해 둔 것 */
async function pageFirst(e, req, url) {
  const cache = await caches.open(CACHE);
  const net = (async () => {
    let res = await fetch(url.href, { cache: "no-cache", credentials: "same-origin" });
    if (res.redirected) res = await fetch(req);           /* 주소가 바뀌는 응답은 화면에 못 쓰는 브라우저가 있다 */
    if (res && res.ok) await cache.put(req, res.clone()).catch(() => {});
    return res;
  })().catch(() => null);

  const quick = await Promise.race([net, new Promise(r => setTimeout(() => r("slow"), PAGE_WAIT))]);
  if (quick && quick !== "slow") return quick;
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) { e.waitUntil(net); return hit; }               /* 늦게라도 받으면 저장해 두고 다음에 쓴다 */
  const res = await net;
  if (res) return res;
  const fb = await cache.match("./index.html");            /* 아무것도 없으면 첫 화면이라도 */
  return fb || new Response("오프라인이라 열 수 없어요", {
    status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                       /* 저장 요청(POST)은 손대지 않는다 */
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.hostname.indexOf("script.google") >= 0) return; /* 서버는 언제나 실시간으로 */
  const mine = (url.origin === location.origin);
  const font = (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com");
  if (!mine && !font) return;

  if (mine && isPage(req, url)) { e.respondWith(pageFirst(e, req, url)); return; }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(mine ? new Request(req, { cache: "no-cache" }) : req).then(res => {
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (hit) { e.waitUntil(net); return hit; }            /* 저장해 둔 것 먼저 */
    const res = await net;
    if (res) return res;
    return new Response("", { status: 504 });
  })());
});
