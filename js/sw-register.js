/* يسجّل ملف الخدمة فور تحميل الصفحة (مبكراً) ليكتشفه المتصفح وأدوات التغليف */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}
