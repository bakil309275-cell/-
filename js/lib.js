/* منطق المكتبة: الشجرة، العناصر، السلة، المكتبة المنشورة، النسخ */
import * as DB from './db.js';
import { uid } from './db.js';
import { sanitizeHTML } from './sanitize.js';
import { b64enc, b64dec, encrypt, decryptText } from './crypto.js';

export const S = {
  tree: { types: [] },
  items: new Map(),     // العناصر المحلية (بما فيها المحذوفة)
  remote: null,         // المكتبة المنشورة {tree,items,contact,publishedAt}
  hidden: new Set(),    // عناصر منشورة حذفها المسؤول نهائياً من جهازه
  settings: { contact: { whatsapp: '', email: '' }, gh: { owner: 'bakil309275-cell', repo: '-', branch: '', tokenEnc: null }, sync: {} },
  admin: null,          // سجل تجزئة كلمة المرور
};

const DEFAULT_TYPES = [
  ['models', '📄', 'النماذج'], ['books', '📚', 'الكتب'], ['videos', '🎥', 'الفيديوهات'],
  ['templates', '🧾', 'الصيغ'], ['laws', '⚖️', 'القوانين'], ['records', '📂', 'المذكرات'],
];

export async function init() {
  const [tree, items, hidden, settings, admin, remote] = await Promise.all([
    DB.kv.get('tree'), DB.items.all(), DB.kv.get('hidden', []), DB.kv.get('settings'), DB.kv.get('admin'), DB.kv.get('remote'),
  ]);
  S.items = new Map(items.map((i) => [i.id, i]));
  S.hidden = new Set(hidden);
  if (settings) S.settings = { ...S.settings, ...settings, contact: { ...S.settings.contact, ...settings.contact }, gh: { ...S.settings.gh, ...settings.gh } };
  S.admin = admin;
  S.remote = remote;
  if (tree) S.tree = tree;
  else {
    S.tree = { types: DEFAULT_TYPES.map(([id, icon, title]) => ({ id, icon, title, cats: [] })) };
    await migrateLegacy();
    await saveTree();
  }
}

/* ---------- ترحيل بيانات النسخة القديمة (vFinal) إن وُجدت على هذا الجهاز ---------- */
async function migrateLegacy() {
  let old;
  try { old = JSON.parse(localStorage.getItem('maktabat_alaysaei_meta_vfinal') || 'null'); } catch { old = null; }
  const oldPw = localStorage.getItem('maktabat_alaysaei_admin_vfinal');
  if (oldPw && !S.admin) {
    const { hashPassword } = await import('./crypto.js');
    S.admin = await hashPassword(oldPw);
    await DB.kv.set('admin', S.admin);
    localStorage.removeItem('maktabat_alaysaei_admin_vfinal'); // لا تبقى كلمة المرور نصاً صريحاً
  }
  if (!old?.types?.length) return;
  const legacyBlob = await readLegacyFiles();
  S.tree = { types: [] };
  for (const t of old.types) {
    const type = { id: t.id || uid('t'), icon: t.icon || '📁', title: t.title || 'بدون اسم', cats: [] };
    S.tree.types.push(type);
    for (const c of t.categories || []) {
      const cat = { id: uid('c'), title: c.title || 'قسم' };
      type.cats.push(cat);
      for (const ex of c.examples || []) {
        const files = [];
        for (const f of ex.files || []) {
          const b = legacyBlob.get(f.id);
          if (b) { await DB.blobs.put({ id: f.id, blob: b, name: f.name, type: f.type, size: f.size }); files.push({ id: f.id, name: f.name, type: f.type, size: f.size }); }
        }
        const it = { id: uid('i'), typeId: type.id, catId: cat.id, title: ex.title || 'بدون عنوان', kind: 'text', text: ex.text || '', files, pub: true, created: Date.now(), updated: Date.now() };
        S.items.set(it.id, it);
        await DB.items.put(it);
      }
    }
  }
  try {
    for (const u of legacyBlob.uploads || []) await DB.log.put({ id: u.id, name: u.name || '', message: u.message || '', files: (u.files || []).map((f) => f.name), created: u.created || Date.now(), channel: 'legacy' });
  } catch { /* ignore */ }
}

function readLegacyFiles() {
  return new Promise((resolve) => {
    const out = new Map();
    out.uploads = [];
    if (!indexedDB.databases) return resolve(out);
    indexedDB.databases().then((list) => {
      if (!list.some((d) => d.name === 'maktabat_alaysaei_db_vfinal')) return resolve(out);
      const rq = indexedDB.open('maktabat_alaysaei_db_vfinal');
      rq.onerror = () => resolve(out);
      rq.onsuccess = () => {
        const db = rq.result;
        try {
          const tx = db.transaction(['files', 'uploads'], 'readonly');
          tx.objectStore('files').getAll().onsuccess = (e) => { for (const r of e.target.result) if (r.file instanceof Blob) out.set(r.id, r.file); };
          tx.objectStore('uploads').getAll().onsuccess = (e) => { out.uploads = e.target.result; };
          tx.oncomplete = () => { db.close(); resolve(out); };
          tx.onerror = () => { db.close(); resolve(out); };
        } catch { db.close(); resolve(out); }
      };
    }).catch(() => resolve(out));
  });
}

/* ---------- حفظ ---------- */
export const saveTree = () => DB.kv.set('tree', S.tree);
export const saveSettings = () => DB.kv.set('settings', S.settings);
const saveHidden = () => DB.kv.set('hidden', [...S.hidden]);
export async function saveAdmin(rec) { S.admin = rec; await DB.kv.set('admin', rec); }

/* ---------- العرض المدمج (محلي + منشور) ---------- */
export function view() {
  const types = JSON.parse(JSON.stringify(S.tree.types));
  const catIds = new Set(types.flatMap((t) => t.cats.map((c) => c.id)));
  if (S.remote?.tree) {
    for (const rt of S.remote.tree.types) {
      let t = types.find((x) => x.id === rt.id);
      if (!t) { t = { id: rt.id, icon: rt.icon, title: rt.title, cats: [], remote: true }; types.push(t); }
      for (const rc of rt.cats) if (!catIds.has(rc.id)) { t.cats.push({ ...rc, remote: true }); catIds.add(rc.id); }
    }
  }
  const items = [];
  for (const it of S.items.values()) if (!it.deleted) items.push(it);
  if (S.remote?.items) {
    for (const r of S.remote.items) if (!S.items.has(r.id) && !S.hidden.has(r.id)) items.push({ ...r, remote: true, pub: true });
  }
  return { types, items };
}

export const getItem = (id) => S.items.get(id) || (S.remote?.items || []).map((r) => ({ ...r, remote: true, pub: true })).find((r) => r.id === id) || null;
export const trashed = () => [...S.items.values()].filter((i) => i.deleted).sort((a, b) => b.deleted - a.deleted);

/* ---------- أنواع وأقسام ---------- */
export async function addType(title, icon) { const t = { id: uid('t'), icon: icon || '📁', title, cats: [] }; S.tree.types.push(t); await saveTree(); return t; }
export async function editType(id, title, icon) { const t = S.tree.types.find((x) => x.id === id); if (!t) return; t.title = title; t.icon = icon || t.icon; await saveTree(); }
export async function addCat(typeId, title) {
  const t = S.tree.types.find((x) => x.id === typeId);
  if (!t) throw new Error('هذا النوع غير موجود على جهازك. استورد المكتبة المنشورة أولاً.');
  const c = { id: uid('c'), title }; t.cats.push(c); await saveTree(); return c;
}
export async function renameCat(typeId, catId, title) { const c = S.tree.types.find((x) => x.id === typeId)?.cats.find((x) => x.id === catId); if (c) { c.title = title; await saveTree(); } }

async function softDelete(it, typeTitle, catTitle) {
  it.deleted = Date.now(); it.delFrom = { typeTitle, catTitle };
  await DB.items.put(it);
}
export async function deleteCat(typeId, catId) {
  const t = S.tree.types.find((x) => x.id === typeId); const c = t?.cats.find((x) => x.id === catId); if (!c) return 0;
  let n = 0;
  for (const it of S.items.values()) if (it.catId === catId && !it.deleted) { await softDelete(it, t.title, c.title); n++; }
  t.cats = t.cats.filter((x) => x.id !== catId); await saveTree(); return n;
}
export async function deleteType(typeId) {
  const t = S.tree.types.find((x) => x.id === typeId); if (!t) return 0;
  let n = 0;
  for (const c of t.cats) for (const it of S.items.values()) if (it.catId === c.id && !it.deleted) { await softDelete(it, t.title, c.title); n++; }
  S.tree.types = S.tree.types.filter((x) => x.id !== typeId); await saveTree(); return n;
}

/* ---------- العناصر ---------- */
export async function saveItem(data) {
  const now = Date.now();
  const prev = data.id ? S.items.get(data.id) : null;
  const it = { files: [], pub: false, kind: 'text', ...prev, ...data, id: data.id || uid('i'), created: prev?.created || now, updated: now };
  if (it.kind === 'doc') it.html = sanitizeHTML(it.html);
  S.items.set(it.id, it);
  await DB.items.put(it);
  return it;
}
export async function trashItem(id) {
  const it = S.items.get(id); if (!it) return;
  const t = S.tree.types.find((x) => x.id === it.typeId); const c = t?.cats.find((x) => x.id === it.catId);
  await softDelete(it, t?.title || '', c?.title || '');
}
/* يضمن وجود نوع/قسم للعنصر المستعاد */
export async function restoreItem(id) {
  const it = S.items.get(id); if (!it) return;
  let t = S.tree.types.find((x) => x.id === it.typeId) || S.tree.types.find((x) => x.title === it.delFrom?.typeTitle);
  if (!t) { t = S.tree.types.find((x) => x.id === 'records') || S.tree.types[0] || (await addType(it.delFrom?.typeTitle || 'مستعاد', '📁')); }
  let c = t.cats.find((x) => x.id === it.catId) || t.cats.find((x) => x.title === it.delFrom?.catTitle);
  if (!c) { c = { id: uid('c'), title: it.delFrom?.catTitle || 'مستعاد' }; t.cats.push(c); }
  it.typeId = t.id; it.catId = c.id; delete it.deleted; delete it.delFrom;
  await saveTree(); await DB.items.put(it);
}
export async function purgeItem(id) {
  const it = S.items.get(id); if (!it) return;
  for (const f of it.files || []) {
    const shared = [...S.items.values()].some((o) => o.id !== id && (o.files || []).some((x) => x.id === f.id));
    if (!shared) await DB.blobs.del(f.id);
  }
  S.items.delete(id); await DB.items.del(id);
  S.hidden.add(id); await saveHidden(); // لا يعود من المكتبة المنشورة المخزّنة
}
export async function moveItem(id, typeId, catId) { const it = S.items.get(id); if (!it) return; it.typeId = typeId; it.catId = catId; it.updated = Date.now(); await DB.items.put(it); }

/* ---------- المرفقات ---------- */
export async function attach(itemId, files) {
  const it = S.items.get(itemId); if (!it) throw new Error('العنصر غير موجود');
  for (const f of files) {
    const id = uid('f');
    await DB.blobs.put({ id, blob: f, name: f.name, type: f.type || 'application/octet-stream', size: f.size });
    it.files.push({ id, name: f.name, type: f.type || 'application/octet-stream', size: f.size });
  }
  it.updated = Date.now(); await DB.items.put(it);
}
export async function detach(itemId, fileId) {
  const it = S.items.get(itemId); if (!it) return;
  it.files = it.files.filter((f) => f.id !== fileId); it.updated = Date.now();
  await DB.items.put(it); await DB.blobs.del(fileId);
}
export async function getBlob(fileId, meta) {
  const local = await DB.blobs.get(fileId);
  if (local) return local.blob;
  const res = await fetch(`data/files/${encodeURIComponent(fileId)}`, { cache: 'force-cache' });
  if (!res.ok) throw new Error('الملف غير متاح (تحقق من الاتصال)');
  return new Blob([await res.arrayBuffer()], { type: meta?.type || 'application/octet-stream' });
}

/* ---------- المكتبة المنشورة (للزوّار) ---------- */
export async function loadRemote() {
  try {
    const res = await fetch('data/library.json', { cache: 'no-cache' });
    if (!res.ok) return false;
    const data = await res.json();
    if (!data?.tree?.types || !Array.isArray(data.items)) return false;
    S.remote = data; await DB.kv.set('remote', data);
    return true;
  } catch { return false; }
}
export const contact = () => ({ ...(S.remote?.contact || {}), ...Object.fromEntries(Object.entries(S.settings.contact).filter(([, v]) => v)) });

export async function importRemote() {
  if (!S.remote) throw new Error('لا توجد مكتبة منشورة محمّلة');
  let n = 0;
  for (const rt of S.remote.tree.types) {
    let t = S.tree.types.find((x) => x.id === rt.id);
    if (!t) { t = { id: rt.id, icon: rt.icon, title: rt.title, cats: [] }; S.tree.types.push(t); }
    for (const rc of rt.cats) if (!t.cats.some((c) => c.id === rc.id) && !S.tree.types.some((x) => x.cats.some((c) => c.id === rc.id))) t.cats.push({ id: rc.id, title: rc.title });
  }
  for (const r of S.remote.items) {
    if (S.items.has(r.id)) continue;
    const files = [];
    for (const f of r.files || []) {
      try { const blob = await getBlob(f.id, f); await DB.blobs.put({ id: f.id, blob, name: f.name, type: f.type, size: f.size }); files.push(f); } catch { /* تخطَّ الملف غير المتاح */ }
    }
    const it = { ...r, files, pub: true }; S.items.set(it.id, it); await DB.items.put(it); n++;
  }
  S.hidden.clear(); await saveHidden(); await saveTree();
  return n;
}

export function publishable() { return [...S.items.values()].filter((i) => !i.deleted && i.pub); }

export async function buildPublish() {
  const items = publishable();
  const usedCats = new Set(items.map((i) => i.catId));
  const tree = { types: S.tree.types.map((t) => ({ id: t.id, icon: t.icon, title: t.title, cats: t.cats.filter((c) => usedCats.has(c.id)).map((c) => ({ id: c.id, title: c.title })) })).filter((t) => t.cats.length) };
  const lib = {
    version: 2, publishedAt: new Date().toISOString(),
    contact: { whatsapp: S.settings.contact.whatsapp || '', email: S.settings.contact.email || '' },
    tree,
    items: items.map((i) => ({ id: i.id, typeId: i.typeId, catId: i.catId, title: i.title, kind: i.kind, text: i.kind === 'text' ? i.text : undefined, html: i.kind === 'doc' ? i.html : undefined, files: i.files, created: i.created, updated: i.updated })),
  };
  const files = { 'data/library.json': JSON.stringify(lib) };
  for (const i of items) for (const f of i.files || []) {
    const b = await DB.blobs.get(f.id);
    if (b) files['data/files/' + f.id] = new Uint8Array(await b.blob.arrayBuffer());
  }
  return { lib, files, count: items.length };
}

/* ---------- النسخ الكاملة ---------- */
export async function exportAll() {
  const blobs = [];
  for (const b of await DB.blobs.all()) blobs.push({ id: b.id, name: b.name, type: b.type, size: b.size, b64: b64enc(new Uint8Array(await b.blob.arrayBuffer())) });
  return { app: 'alaisai-library', version: 2, exportedAt: new Date().toISOString(), tree: S.tree, items: [...S.items.values()], hidden: [...S.hidden], contact: S.settings.contact, log: await DB.log.all(), blobs };
}
export async function exportPackage(passphrase) {
  const data = JSON.stringify(await exportAll());
  return passphrase ? JSON.stringify(await encrypt(data, passphrase)) : data;
}
export async function parsePackage(text, passphrase) {
  let obj = JSON.parse(text);
  if (obj?.alaisai === 1) {
    if (!passphrase) { const e = new Error('NEED_PASS'); e.needPass = true; throw e; }
    obj = JSON.parse(await decryptText(obj, passphrase));
  }
  if (obj?.app === 'alaisai-library') return obj;
  if (Array.isArray(obj?.types)) return convertLegacyExport(obj); // تصدير النسخة القديمة (meta فقط)
  throw new Error('الملف ليس نسخة صالحة من المكتبة');
}
function convertLegacyExport(old) {
  const tree = { types: [] }; const items = [];
  for (const t of old.types) {
    const type = { id: t.id || uid('t'), icon: t.icon || '📁', title: t.title || '', cats: [] }; tree.types.push(type);
    for (const c of t.categories || []) {
      const cat = { id: uid('c'), title: c.title }; type.cats.push(cat);
      for (const ex of c.examples || []) items.push({ id: uid('i'), typeId: type.id, catId: cat.id, title: ex.title, kind: 'text', text: ex.text || '', files: [], pub: true, created: Date.now(), updated: Date.now() });
    }
  }
  return { app: 'alaisai-library', version: 2, tree, items, hidden: [], blobs: [], log: [] };
}
/* mode: 'merge' (يدمج دون حذف) | 'replace' (يستبدل كل شيء) */
export async function applyPackage(pkg, mode) {
  if (mode === 'replace') {
    await Promise.all([DB.items.clear(), DB.blobs.clear()]);
    S.items = new Map(); S.tree = { types: [] }; S.hidden = new Set();
  }
  for (const rt of pkg.tree.types) {
    let t = S.tree.types.find((x) => x.id === rt.id);
    if (!t) { t = { id: rt.id, icon: rt.icon, title: rt.title, cats: [] }; S.tree.types.push(t); }
    for (const rc of rt.cats) if (!t.cats.some((c) => c.id === rc.id)) t.cats.push({ id: rc.id, title: rc.title });
  }
  let n = 0;
  for (const b of pkg.blobs || []) await DB.blobs.put({ id: b.id, blob: new Blob([b64dec(b.b64)], { type: b.type }), name: b.name, type: b.type, size: b.size });
  for (const it of pkg.items) {
    const cur = S.items.get(it.id);
    if (cur && (cur.updated || 0) >= (it.updated || 0)) continue;
    if (it.kind === 'doc') it.html = sanitizeHTML(it.html);
    S.items.set(it.id, it); await DB.items.put(it); n++;
  }
  for (const l of pkg.log || []) await DB.log.put(l);
  if (pkg.contact && mode === 'replace') S.settings.contact = { ...S.settings.contact, ...pkg.contact };
  S.hidden = new Set([...(mode === 'replace' ? [] : S.hidden), ...(pkg.hidden || [])]);
  await Promise.all([saveTree(), saveHidden(), saveSettings()]);
  return n;
}

/* ---------- سجل الرسائل المرسلة من هذا الجهاز ---------- */
export const logAll = () => DB.log.all().then((l) => l.sort((a, b) => b.created - a.created));
export const logAdd = (e) => DB.log.put({ id: uid('m'), created: Date.now(), ...e });
export const logDel = (id) => DB.log.del(id);
export const logClear = () => DB.log.clear();

export async function eraseEverything() { await DB.wipeAll(); localStorage.clear(); }
