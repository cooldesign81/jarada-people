// 자라다 People 서비스 워커: 앱 화면(html·css·js)만 보관해 두고, 인터넷이 끊겼을 때 화면 껍데기를 띄운다.
// 직원 정보(Firebase 데이터)는 절대 보관하지 않는다. 다른 사이트(Firebase, 폰트)로 가는 요청은 건드리지 않는다.
const CACHE = "jarada-shell-v2";
const SHELL = ["./", "./index.html", "./css/app.css", "./manifest.webmanifest", "./icons/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  // 등록 링크 주소의 토큰(?self=&t=)이 보관되지 않도록 주소에서 검색어를 뺀 키로 저장한다
  const key = new Request(url.origin + url.pathname);
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then((hit) => hit || caches.match("./index.html")))
  );
});
