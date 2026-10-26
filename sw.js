const CACHE_NAME = 'alaisai-legal-v1';
const ASSETS_TO_CACHE = [
  './index.html',
  './manifest.json',
  './icons/icon-192x192.png',
  './icons/icon-512x512.png',
  './icons/maskable-icon.png'
  // يمكنك إضافة أي ملفات CSS أو JavaScript إضافية هنا إذا وجدت
];

// تثبيت ملف الـ Service Worker وتخزين الملفات الأساسية مؤقتاً
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// تفعيل ملف الخدمة وتنظيف الكاش القديم إن وجد
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// اعتراض الطلبات لتشغيل الموقع حتى في حال انقطاع الإنترنت (Cache First strategy)
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // إرجاع الملف من الذاكرة المؤقتة إن وجد
      }
      return fetch(event.request).then((response) => {
        // التحقق من صحة الاستجابة قبل تخزينها
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      }).catch(() => {
        // في حال انقطاع الإنترنت ولم يتم العثور على الملف، يمكن توفير صفحة بديلة إن لزم
      });
    })
  );
});
