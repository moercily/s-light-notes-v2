/* ============================================
   s-light notes — Service Worker
   缓存应用壳，支持离线访问
   ============================================ */

const CACHE_PREFIX = 's-light-notes-v2-';
const CACHE_NAME = CACHE_PREFIX + 'alpha-4';

// 需要缓存的静态资源
const STATIC_ASSETS = [
    './',
    './index.html',
    './mobile.html',
    './manifest.json',
    './manifest.mobile.json',
    './css/style.css',
    './css/mobile.css',
    './js/utils.js',
    './js/storage.js',
    './js/desktop-service.js',
    './js/sync.js',
    './js/sync-service.js',
    './js/sync-center.js',
    './js/sidebar.js',
    './js/editor.js',
    './js/app.js',
    './js/mobile.js',
    './icons/icon.svg',
    './icons/icon-192.png',
    './icons/icon-512.png',
];

// ========== 安装：预缓存静态资源 ==========

self.addEventListener('install', (event) => {
    console.log('[SW] 安装中...');
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] 缓存静态资源');
            return cache.addAll(STATIC_ASSETS);
        }).then(() => {
            // 立即激活，不等待旧 SW 释放
            return self.skipWaiting();
        })
    );
});

// ========== 激活：清理旧缓存 ==========

self.addEventListener('activate', (event) => {
    console.log('[SW] 激活');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] 删除旧缓存:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            // 立即接管所有页面
            return self.clients.claim();
        })
    );
});

// ========== 请求拦截：缓存优先策略 ==========

self.addEventListener('fetch', (event) => {
    // 只处理 GET 请求
    if (event.request.method !== 'GET') return;

    // 跳过 chrome-extension 等非 http(s) 请求
    if (!event.request.url.startsWith('http')) return;

    // 只处理本应用同源资源，不拦截 Syncthing 等本机跨端口 API
    const requestUrl = new URL(event.request.url);
    const appUrl = new URL(self.location.href);
    if (requestUrl.origin !== appUrl.origin) return;

    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // 缓存命中，直接返回
                return cachedResponse;
            }

            // 缓存未命中，从网络获取
            return fetch(event.request).then((response) => {
                // 只缓存成功的响应
                if (!response || response.status !== 200) {
                    return response;
                }

                // 将响应克隆一份存入缓存
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });

                return response;
            }).catch(() => {
                // 网络失败且无缓存，返回离线页面
                // 对于导航请求（HTML），返回缓存的 index.html
                if (event.request.mode === 'navigate') {
                    const url = new URL(event.request.url);
                    if (url.pathname.endsWith('/mobile.html')) {
                        return caches.match('./mobile.html');
                    }
                    return caches.match('./index.html');
                }
                // 对于其他请求，静默失败
                return new Response('', { status: 408 });
            });
        })
    );
});
