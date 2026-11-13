/* 白sir 的个人助手 · Service Worker · v3.2
 * - 只缓存 v3 应用壳；天气等跨域请求一律直连放行，绝不写进 CacheStorage
 *   （天气只存在 localStorage.weatherCache，页面自己处理超时 / 失败降级）。
 * - 应用壳“网络优先、超时回落缓存”：发新版后下次打开就能拿到，断网也能打开。
 * - 激活时删除所有旧缓存（v2 的 baiAssistant-shell-*），避免旧版卡住。
 * - WorkBuddy 网关要求带 ?sharecode=，所以预缓存 URL 带上它；匹配时 ignoreSearch。
 */
var VERSION = "3.3.0";
var CACHE = "baisir-v3-shell-" + VERSION;
var Q = "?sharecode=XQYKQCQM2D";
var APP_SHELL = [
  "./" + Q, "./index.html" + Q, "./styles.css" + Q, "./app.js" + Q,
  "./manifest.webmanifest" + Q, "./icon.svg" + Q, "./icon-192.png" + Q, "./icon-512.png" + Q, "./apple-touch-icon.png" + Q
];
var SHELL_FILES = ["", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png"];
var NET_TIMEOUT = 3500;

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 逐个缓存：单个资源失败不阻断安装
      return Promise.all(APP_SHELL.map(function (u) {
        return fetch(u, { cache: "reload", credentials: "same-origin" }).then(function (res) {
          if (res && res.ok) return c.put(u, res);
        }).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        var ours = k.indexOf("baiAssistant-shell-") === 0 || k.indexOf("baisir-") === 0;
        return (ours && k !== CACHE) ? caches.delete(k) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function relPath(url) {
  var base = self.location.pathname.replace(/[^/]*$/, "");
  if (url.pathname.indexOf(base) !== 0) return null;
  return url.pathname.slice(base.length);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;          // 天气 API 等：不拦截、不缓存
  var rel = relPath(url);
  var isNav = req.mode === "navigate";
  if (!isNav && (rel === null || SHELL_FILES.indexOf(rel) < 0)) return;

  e.respondWith(networkFirst(req, isNav));
});

function networkFirst(req, isNav) {
  return new Promise(function (resolve) {
    var done = false;
    function fallback() {
      if (done) return; done = true;
      caches.open(CACHE).then(function (c) {
        return c.match(req, { ignoreSearch: true }).then(function (hit) {
          return hit || (isNav ? c.match("./index.html" + Q, { ignoreSearch: true }) : null);
        });
      }).then(function (hit) {
        resolve(hit || fetch(req).catch(function () { return new Response("离线，且没有缓存", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }); }));
      });
    }
    var timer = setTimeout(fallback, NET_TIMEOUT);
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        clearTimeout(timer);
        if (!done) { done = true; resolve(res); }
      } else {
        clearTimeout(timer); fallback();
      }
    }).catch(function () { clearTimeout(timer); fallback(); });
  });
}
