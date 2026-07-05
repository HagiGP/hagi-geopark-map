/* 萩ジオパーク マップ — Service Worker（オフライン対応）
   方針：アプリの土台は先読みキャッシュ。データ・タイル・画像は
   「キャッシュ優先＋裏で更新」＝一度見た所はオフラインでも表示できる。 */
const CACHE = "hagimap-v1";

// 起動に最低限必要なもの（バージョン非依存のもののみ。CSS/JS/データは実行時に取り込む）
const PRECACHE = [
  "index.html",
  "manifest.webmanifest",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "img/logo-badge.png",
  "img/icon-192.png",
  "img/icon-512.png",
  "img/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // ページ本体（index.html）はネット優先＝更新を確実に反映。オフライン時はキャッシュ
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => { caches.open(CACHE).then((c) => c.put(req, res.clone())); return res; })
        .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
    );
    return;
  }

  // CSS/JS/データ/タイル/画像：キャッシュ優先。無ければ取得してキャッシュ。裏でも更新
  e.respondWith(
    caches.match(req).then((cached) => {
      const net = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
