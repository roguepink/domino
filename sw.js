'use strict';
/* オフラインでも遊べるようにする(ホーム画面に入れたあと、電波がなくても起動する)。
   ゲームの部品(index.html・css・js・3D の three.js)と アイコン類を覚えておく。
   ゲームを直しただけなら VERSION は そのままでいい(開くたびに、まずネットで最新を取りにいくので)。
   FILES(覚えるファイル)を変えたときだけ VERSION を 1つ上げる(古い覚えを 一斉に捨てる)。 */
const VERSION = 'domino-v3';
const FILES = [
  './', 'index.html', 'install.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png', 'css/style.css', 'js/config.js', 'js/level.js', 'js/sim.js', 'js/worlds.js', 'js/stages.js', 'js/save.js', 'js/input.js', 'js/audio.js', 'js/render2d.js', 'js/ui.js', 'js/bot.js', 'js/main.js', 'js/render3d.js', 'vendor/three/build/three.module.min.js', 'vendor/three/build/three.core.js', 'shots/1.jpg', 'shots/2.jpg', 'shots/3.jpg', 'shots/4.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

/* 開くときは まずネットで最新を取りにいく。つながらなければ 覚えているものを出す。 */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        // ?a=1 などの印は 覚えるときに消す(同じファイルを 何こも覚えないように)
        if (res.ok) { const copy = res.clone(), u = new URL(req.url); u.search = ''; caches.open(VERSION).then((c) => c.put(u.href, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
