/* مكتبة العيسائي القانونية الرقمية — الواجهة (v2) */
import { h, toast, modal, confirmBox, form, infoBox, showMenu, saveBlob, printHTML, highlight, norm, normMap, fmtSize, fmtDate } from './ui.js';
import * as L from './lib.js';
import { S } from './lib.js';
import * as DB from './db.js';
import { hashPassword, verifyPassword, encrypt, decryptText } from './crypto.js';
import { sanitizeHTML, escapeHTML } from './sanitize.js';
import * as GH from './github.js';

const $ = (id) => document.getElementById(id);
const ui = { typeId: null, q: '', open: new Set(), cur: null, admin: false };
const session = { pw: null, token: null };
let lock = null;

/* ======================= الإدارة وكلمة المرور ======================= */
function setAdmin(on) {
  ui.admin = on;
  document.body.classList.toggle('admin', on);
  $('btn-admin').textContent = on ? '🔓 الإدارة' : '🔒 الإدارة';
  clearTimeout(lock);
  if (on) bumpLock();
  renderAll();
}
function bumpLock() { clearTimeout(lock); if (ui.admin) lock = setTimeout(() => { lockAdmin(); toast('تم قفل الإدارة تلقائياً لعدم النشاط'); }, 15 * 60 * 1000); }
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, bumpLock, { passive: true }));

function lockAdmin() { session.pw = null; session.token = null; setAdmin(false); }

async function unlockToken() {
  const enc = S.settings.gh.tokenEnc;
  session.token = null;
  if (enc && session.pw) { try { session.token = await decryptText(enc, session.pw); } catch { /* رمز تالف */ } }
}

async function requireAdmin() {
  if (ui.admin) return true;
  if (!S.admin) {
    const r = await form('إنشاء كلمة مرور الإدارة', [
      { name: 'p1', label: 'كلمة المرور (6 أحرف فأكثر)', type: 'password', required: true },
      { name: 'p2', label: 'تأكيد كلمة المرور', type: 'password', required: true },
    ], 'إنشاء', { validate: (v) => (v.p1.length < 6 ? 'كلمة المرور قصيرة (6 أحرف على الأقل)' : v.p1 !== v.p2 ? 'كلمتا المرور غير متطابقتين' : null) });
    if (!r) return false;
    await L.saveAdmin(await hashPassword(r.p1));
    session.pw = r.p1; setAdmin(true); toast('تم إنشاء كلمة المرور. احفظها جيداً: لا يمكن استرجاعها.');
    return true;
  }
  let tries = 0;
  for (;;) {
    const extra = h('button', { type: 'button', class: 'link', text: 'نسيت كلمة المرور؟', onclick: forgotPassword });
    const r = await form('دخول الإدارة', [{ name: 'p', label: 'كلمة المرور', type: 'password', required: true }], 'دخول', { extra });
    if (!r) return false;
    if (await verifyPassword(r.p, S.admin)) { session.pw = r.p; await unlockToken(); setAdmin(true); return true; }
    tries++; toast('كلمة المرور غير صحيحة', 'err');
    await new Promise((res) => setTimeout(res, Math.min(5000, tries * 800)));
  }
}

async function forgotPassword() {
  const ok = await confirmBox('لا يمكن استرجاع كلمة المرور. المتاح فقط: مسح كل بيانات هذا الجهاز (المكتبة والإعدادات) ثم استعادتها من نسخة احتياطية أو من المكتبة المنشورة. هل تريد المسح؟', 'مسح بيانات الجهاز', true);
  if (!ok) return;
  await L.eraseEverything();
  location.reload();
}

/* ======================= العرض ======================= */
const textCache = new Map();
function plain(it) {
  const k = it.id + ':' + (it.updated || 0);
  if (!textCache.has(k)) {
    textCache.set(k, it.kind === 'doc' ? new DOMParser().parseFromString(`<body>${it.html || ''}</body>`, 'text/html').body.textContent : it.text || '');
  }
  return textCache.get(k);
}

function renderAll() { renderStrip(); renderTree(); renderViewer(); renderContact(); renderAdminBar(); }

function renderAdminBar() {
  const bar = $('admin-bar');
  bar.replaceChildren();
  if (!ui.admin) return;
  const b = (label, fn, cls = 'neutral') => h('button', { class: 'btn ' + cls, text: label, onclick: fn });
  bar.append(
    b('✍️ محرر المستندات', () => openEditor()),
    b('➕ نموذج جديد', () => newItem()),
    b('🗑️ السلة (' + L.trashed().length + ')', openTrash),
    b('☁️ المزامنة والنشر', openSync, 'primary'),
    b('📥 الرسائل المرسلة', openLog),
    b('⚙️ الإعدادات', openSettings),
    b('🔒 قفل', lockAdmin),
  );
}

function renderStrip() {
  const root = $('top-icons'); root.replaceChildren();
  const { types } = L.view();
  if (!types.some((t) => t.id === ui.typeId)) ui.typeId = types[0]?.id || null;
  for (const t of types) {
    const btn = h('button', { class: 'strip-item' + (t.id === ui.typeId ? ' active' : ''), onclick: () => { ui.typeId = t.id; ui.q = ''; $('search').value = ''; renderStrip(); renderTree(); } },
      h('span', { class: 'ic', text: t.icon }), h('span', { class: 'tt', text: t.title }));
    if (ui.admin && !t.remote) {
      btn.append(h('span', { class: 'dots', 'data-menu': '1', role: 'button', 'aria-label': 'خيارات', text: '⋮', onclick: (e) => { e.stopPropagation(); typeMenu(e.currentTarget, t); } }));
    }
    root.append(btn);
  }
  if (ui.admin) root.append(h('button', { class: 'strip-item add', text: '＋ أيقونة', onclick: addType }));
}

function snippet(text, q) {
  const { n, map } = normMap(text);
  const i = n.indexOf(norm(q));
  if (i < 0) return text.slice(0, 80);
  const st = Math.max(0, map[i] - 30);
  return (st ? '…' : '') + text.slice(st, st + 100) + '…';
}

function itemRow(it, q) {
  const row = h('div', { class: 'item-row' + (ui.cur === it.id ? ' sel' : ''), role: 'button', tabindex: '0', onclick: () => openItem(it.id), onkeydown: (e) => { if (e.key === 'Enter') openItem(it.id); } },
    h('span', { class: 'ic', text: it.kind === 'doc' ? '✍️' : '📄' }),
    h('span', { class: 'it-title' }, highlight(it.title, q)),
    it.files?.length ? h('span', { class: 'badge', title: 'مرفقات', text: '📎' + it.files.length }) : null,
    ui.admin && it.pub && !it.remote ? h('span', { class: 'badge pub', title: 'منشور للعامة', text: '🌐' }) : null,
    ui.admin ? h('span', { class: 'dots', 'data-menu': '1', role: 'button', 'aria-label': 'خيارات', text: '⋮', onclick: (e) => { e.stopPropagation(); itemMenu(e.currentTarget, it); } }) : null);
  return row;
}

function renderTree() {
  const root = $('public-index-root'); root.replaceChildren();
  const { types, items } = L.view();
  const q = norm(ui.q).trim();
  const typeOf = (id) => types.find((t) => t.id === id);

  if (q) {
    const found = items.filter((i) => norm(i.title).includes(q) || norm(plain(i)).includes(q));
    $('index-title').textContent = `نتائج البحث (${found.length})`;
    if (!found.length) { root.append(h('div', { class: 'empty', text: 'لا توجد نتائج مطابقة.' })); return; }
    for (const it of found) {
      const t = typeOf(it.typeId); const c = t?.cats.find((x) => x.id === it.catId);
      const body = plain(it);
      const inBody = !norm(it.title).includes(q);
      root.append(h('div', { class: 'result' }, h('div', { class: 'small', text: `${t?.icon || ''} ${t?.title || ''} › ${c?.title || ''}` }), itemRow(it, ui.q),
        inBody ? h('div', { class: 'snip' }, highlight(snippet(body, ui.q), ui.q)) : null));
    }
    return;
  }

  const t = typeOf(ui.typeId);
  $('index-title').textContent = t ? `${t.icon} ${t.title}` : 'الفهرس';
  if (!t) { root.append(h('div', { class: 'empty', text: 'لا توجد أيقونات بعد.' })); return; }
  if (ui.admin) root.append(h('button', { class: 'btn neutral wide', text: '＋ إضافة قسم', onclick: () => addCat(t) }));
  if (!t.cats.length) root.append(h('div', { class: 'empty', text: ui.admin ? 'لا توجد أقسام. أضف قسماً ثم أضف إليه نماذج.' : 'لا توجد محتويات منشورة في هذا النوع بعد.' }));
  for (const c of t.cats) {
    const list = items.filter((i) => i.catId === c.id).sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    const open = ui.open.has(c.id);
    const head = h('div', { class: 'cat-row', role: 'button', tabindex: '0', 'aria-expanded': String(open),
      onclick: () => { open ? ui.open.delete(c.id) : ui.open.add(c.id); renderTree(); },
      onkeydown: (e) => { if (e.key === 'Enter') e.currentTarget.click(); } },
    h('span', { class: 'tri', text: open ? '▼' : '◀' }), h('span', { class: 'cat-title', text: c.title }), h('span', { class: 'small', text: `[${list.length}]` }),
    ui.admin ? h('span', { class: 'dots', 'data-menu': '1', role: 'button', 'aria-label': 'خيارات القسم', text: '⋮', onclick: (e) => { e.stopPropagation(); catMenu(e.currentTarget, t, c); } }) : null);
    root.append(h('div', { class: 'cat' }, head, open ? h('div', { class: 'sub-list' }, list.length ? list.map((i) => itemRow(i, '')) : h('div', { class: 'small', text: 'قسم فارغ' })) : null));
  }
}

let objUrls = [];
async function renderViewer() {
  const it = ui.cur ? L.getItem(ui.cur) : null;
  objUrls.forEach((u) => URL.revokeObjectURL(u)); objUrls = [];
  const box = $('viewer-content');
  $('viewer-actions').classList.toggle('hidden', !it);
  if (!it) {
    $('item-title').textContent = 'اختر عنصرًا للعرض'; $('item-meta').textContent = '';
    box.replaceChildren(h('div', { class: 'empty', text: 'المحتوى سيظهر هنا عند اختيار عنصر.' }));
    return;
  }
  const { types } = L.view();
  const t = types.find((x) => x.id === it.typeId); const c = t?.cats.find((x) => x.id === it.catId);
  $('item-title').textContent = it.title;
  $('item-meta').textContent = `${t?.title || ''} › ${c?.title || ''} • ${fmtDate(it.updated || it.created)}${it.remote ? ' • منشور' : ''}`;
  box.replaceChildren();
  if (it.kind === 'doc') { const d = h('div', { class: 'doc' }); d.innerHTML = sanitizeHTML(it.html); box.append(d); }
  else box.append(h('div', { class: 't', text: it.text || '' }));
  if (it.files?.length) {
    const wrap = h('div', { class: 'files' }, h('h4', { text: 'الملفات المرفقة' }));
    for (const f of it.files) {
      const row = h('div', { class: 'file-row' }, h('span', { class: 'fname', text: '📎 ' + f.name }), h('span', { class: 'small', text: fmtSize(f.size || 0) }),
        h('button', { class: 'btn neutral', text: 'عرض', onclick: () => viewFile(f) }), h('button', { class: 'btn neutral', text: 'تنزيل', onclick: () => downloadFile(f) }),
        ui.admin && !it.remote ? h('button', { class: 'btn danger', text: 'إزالة', onclick: async () => { if (await confirmBox(`إزالة المرفق «${f.name}»؟`, 'إزالة', true)) { await L.detach(it.id, f.id); renderViewer(); } } }) : null);
      wrap.append(row);
      if (/^image\//.test(f.type || '')) {
        L.getBlob(f.id, f).then((b) => { const u = URL.createObjectURL(b); objUrls.push(u); row.after(h('img', { class: 'preview', src: u, alt: f.name })); }).catch(() => {});
      }
    }
    box.append(wrap);
  }
}

async function viewFile(f) {
  try { const b = await L.getBlob(f.id, f); const u = URL.createObjectURL(b); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 60000); } catch (e) { toast(e.message, 'err'); }
}
async function downloadFile(f) { try { saveBlob(await L.getBlob(f.id, f), f.name); } catch (e) { toast(e.message, 'err'); } }

function openItem(id) {
  ui.cur = id;
  const it = L.getItem(id);
  if (it && ui.typeId !== it.typeId && !ui.q) ui.typeId = it.typeId;
  if (it) ui.open.add(it.catId);
  history.replaceState(null, '', '#i=' + encodeURIComponent(id));
  renderStrip(); renderTree(); renderViewer();
  if (innerWidth < 900) $('viewer-head').scrollIntoView({ behavior: 'smooth' });
}

/* ======================= إجراءات الأيقونات والأقسام والعناصر (للإدارة) ======================= */
async function addType() {
  const r = await form('إضافة أيقونة/نوع', [{ name: 'title', label: 'العنوان', required: true }, { name: 'icon', label: 'الرمز (إيموجي)', value: '📁' }]);
  if (!r) return;
  const t = await L.addType(r.title.trim(), r.icon.trim()); ui.typeId = t.id; renderAll();
}
function typeMenu(anchor, t) {
  showMenu(anchor, [
    { label: 'تعديل العنوان والرمز', action: async () => { const r = await form('تعديل', [{ name: 'title', label: 'العنوان', value: t.title, required: true }, { name: 'icon', label: 'الرمز', value: t.icon }]); if (r) { await L.editType(t.id, r.title.trim(), r.icon.trim()); renderAll(); } } },
    { label: 'إضافة قسم', action: () => addCat(t) },
    { label: 'حذف (إلى السلة)', danger: true, action: async () => { if (await confirmBox(`حذف «${t.title}» وكل ما فيه؟ ستنتقل العناصر إلى السلة ويمكن استعادتها.`, 'حذف', true)) { const n = await L.deleteType(t.id); toast(`نُقل ${n} عنصر إلى السلة`); renderAll(); } } },
  ]);
}
async function addCat(t) {
  if (t.remote) return toast('هذا النوع منشور فقط؛ استورد المكتبة المنشورة من الإعدادات أولاً.', 'err');
  const name = await promptName('إضافة قسم', 'اسم القسم'); if (!name) return;
  const c = await L.addCat(t.id, name); ui.open.add(c.id); renderAll();
}
const promptName = (title, label, value = '') => form(title, [{ name: 'v', label, value, required: true }]).then((r) => r?.v.trim() || null);

function catMenu(anchor, t, c) {
  if (c.remote) return showMenu(anchor, [{ label: 'استيراد المكتبة المنشورة إلى جهازي', action: importRemote }]);
  showMenu(anchor, [
    { label: 'إضافة نموذج نصي', action: () => newItem(c.id) },
    { label: 'مستند جديد في المحرر', action: () => openEditor(null, c.id) },
    { label: 'إعادة تسمية القسم', action: async () => { const v = await promptName('إعادة تسمية', 'الاسم الجديد', c.title); if (v) { await L.renameCat(t.id, c.id, v); renderAll(); } } },
    { label: 'حذف القسم (إلى السلة)', danger: true, action: async () => { if (await confirmBox(`حذف القسم «${c.title}» وكل نماذجه؟ ستنتقل إلى السلة.`, 'حذف', true)) { const n = await L.deleteCat(t.id, c.id); toast(`نُقل ${n} عنصر إلى السلة`); renderAll(); } } },
  ]);
}

function catOptions(selectedCatId) {
  const opts = [];
  for (const t of S.tree.types) for (const c of t.cats) opts.push({ value: c.id, label: `${t.icon} ${t.title} › ${c.title}`, selected: c.id === selectedCatId });
  return opts;
}
const typeOfCat = (catId) => S.tree.types.find((t) => t.cats.some((c) => c.id === catId));

async function newItem(catId) {
  const opts = catOptions();
  if (!opts.length) return toast('أضف قسماً أولاً (من الفهرس ← إضافة قسم).', 'err');
  const r = await form('إضافة نموذج', [
    { name: 'cat', label: 'القسم', type: 'select', options: opts, value: catId || opts[0].value },
    { name: 'title', label: 'العنوان', required: true },
    { name: 'text', label: 'النص', type: 'textarea', rows: 8 },
    { name: 'files', label: 'مرفقات (اختياري)', type: 'file', multiple: true },
    { name: 'pub', label: 'نشر للعامة عند المزامنة', type: 'checkbox', value: true },
  ], 'إضافة', { wide: true });
  if (!r) return;
  const t = typeOfCat(r.cat);
  const it = await L.saveItem({ typeId: t.id, catId: r.cat, title: r.title.trim(), kind: 'text', text: r.text, pub: r.pub });
  if (r.files.length) await L.attach(it.id, r.files);
  ui.typeId = t.id; openItem(it.id); renderAdminBar(); toast('تمت الإضافة');
}

async function editItem(it) {
  if (it.kind === 'doc') return openEditor(it);
  const r = await form('تعديل النموذج', [
    { name: 'title', label: 'العنوان', value: it.title, required: true },
    { name: 'text', label: 'النص', type: 'textarea', rows: 10, value: it.text },
    { name: 'pub', label: 'نشر للعامة عند المزامنة', type: 'checkbox', value: it.pub },
  ], 'حفظ', { wide: true });
  if (!r) return;
  await L.saveItem({ id: it.id, title: r.title.trim(), text: r.text, pub: r.pub }); textCache.clear(); renderAll(); toast('تم الحفظ');
}

function itemMenu(anchor, it) {
  if (it.remote) return showMenu(anchor, [{ label: 'استيراد المكتبة المنشورة إلى جهازي', action: importRemote }]);
  showMenu(anchor, [
    { label: 'فتح', action: () => openItem(it.id) },
    { label: it.kind === 'doc' ? 'تعديل في المحرر' : 'تعديل', action: () => editItem(it) },
    { label: 'رفع مرفقات', action: () => pickFiles(it) },
    { label: 'نقل إلى قسم آخر', action: () => moveDialog(it) },
    { label: it.pub ? 'إلغاء النشر للعامة' : 'نشر للعامة عند المزامنة', action: async () => { await L.saveItem({ id: it.id, pub: !it.pub }); renderAll(); toast(it.pub ? 'لن يُنشر بعد الآن' : 'سيُنشر عند المزامنة القادمة'); } },
    { label: 'حذف (إلى السلة)', danger: true, action: async () => { await L.trashItem(it.id); if (ui.cur === it.id) ui.cur = null; renderAll(); toast('نُقل إلى السلة'); } },
  ]);
}
function pickFiles(it) {
  const inp = h('input', { type: 'file', multiple: true });
  inp.onchange = async () => { if (!inp.files.length) return; await L.attach(it.id, Array.from(inp.files)); renderAll(); toast('تم إرفاق الملفات'); };
  inp.click();
}
async function moveDialog(it) {
  const r = await form('نقل إلى قسم', [{ name: 'cat', label: 'القسم', type: 'select', options: catOptions(it.catId), value: it.catId }], 'نقل');
  if (!r) return; await L.moveItem(it.id, typeOfCat(r.cat).id, r.cat); renderAll();
}

/* ======================= المحرر الحقيقي ======================= */
const TEMPLATES = {
  blank: '<div style="text-align:center"><h3>بسم الله الرحمن الرحيم</h3></div><p><br></p>',
  petition: '<div style="text-align:center"><h3>بسم الله الرحمن الرحيم</h3></div><p>إلى فضيلة رئيس / [اسم المحكمة] &nbsp; حفظه الله</p><p>مقدمه: [اسم المدعي] &nbsp; — &nbsp; ضد: [اسم المدعى عليه]</p><h3>عريضة دعوى</h3><p><b>الوقائع:</b> [اذكر الوقائع بالتسلسل]</p><p><b>الأسانيد القانونية:</b> [المواد والمبادئ]</p><p><b>الطلبات:</b></p><ol><li>[الطلب الأول]</li><li>[الطلب الثاني]</li></ol><p>وتفضلوا بقبول فائق الاحترام،،،</p><p>مقدمه / ........ &nbsp; التاريخ: ........</p>',
  memo: '<div style="text-align:center"><h3>بسم الله الرحمن الرحيم</h3></div><h3>مذكرة جوابية</h3><p>في القضية رقم: [ ] &nbsp; المقيدة بتاريخ: [ ]</p><p><b>أولاً: في الشكل</b></p><p>[الدفوع الشكلية]</p><p><b>ثانياً: في الموضوع</b></p><p>[الدفوع الموضوعية]</p><p><b>ثالثاً: الطلبات</b></p><p>[الطلبات الختامية]</p>',
};

async function openEditor(item = null, catId = null) {
  const opts = catOptions(item?.catId || catId);
  if (!opts.length) return toast('أضف قسماً أولاً (من الفهرس ← إضافة قسم).', 'err');
  let draft = await DB.kv.get('draft');
  let useDraft = false;
  if (!item && draft?.html && draft.html.replace(/<[^>]+>/g, '').trim().length > 20) useDraft = await confirmBox('وُجدت مسودة غير محفوظة من جلسة سابقة. هل تريد استعادتها؟', 'استعادة');
  let dirty = false, saved = false;
  const area = h('div', { id: 'legal-editor', contenteditable: 'true', dir: 'rtl', spellcheck: 'false', 'aria-label': 'محرر المستند' });
  area.innerHTML = sanitizeHTML(item ? item.html : useDraft ? draft.html : TEMPLATES.blank);
  const title = h('input', { type: 'text', placeholder: 'عنوان المستند / اسم صاحب القضية', value: item?.title || (useDraft ? draft.title : '') });
  const sel = h('select', {}, opts.map((o) => h('option', { value: o.value, text: o.label, selected: o.selected })));
  const pub = h('input', { type: 'checkbox', checked: item ? item.pub : false });
  const tpl = h('select', { onchange: async () => { const v = tpl.value; tpl.value = ''; if (v && (await confirmBox('استبدال محتوى المحرر بالقالب؟', 'استبدال'))) { area.innerHTML = TEMPLATES[v]; dirty = true; } } },
    h('option', { value: '', text: 'إدراج قالب…' }), h('option', { value: 'petition', text: 'عريضة دعوى' }), h('option', { value: 'memo', text: 'مذكرة جوابية' }), h('option', { value: 'blank', text: 'بسملة فقط' }));
  const cmd = (c, v) => { area.focus(); document.execCommand(c, false, v ?? null); };
  const tb = (label, c, v, t) => h('button', { type: 'button', class: 'tb', title: t || label, text: label, onmousedown: (e) => e.preventDefault(), onclick: () => cmd(c, v) });
  const size = h('select', { title: 'حجم الخط', onchange: () => { cmd('fontSize', size.value); size.value = ''; } }, h('option', { value: '', text: 'الحجم' }), ...[['2', 'صغير'], ['3', 'عادي'], ['5', 'كبير'], ['6', 'كبير جداً']].map(([v, t]) => h('option', { value: v, text: t })));
  const toolbar = h('div', { class: 'editor-toolbar' }, tb('B', 'bold', null, 'عريض'), tb('I', 'italic', null, 'مائل'), tb('U', 'underline', null, 'تسطير'),
    tb('⇥', 'justifyRight', null, 'يمين'), tb('≡', 'justifyCenter', null, 'توسيط'), tb('⇤', 'justifyLeft', null, 'يسار'), tb('☰', 'justifyFull', null, 'ضبط'),
    tb('• قائمة', 'insertUnorderedList'), tb('1. ترقيم', 'insertOrderedList'), tb('عنوان', 'formatBlock', 'H3'), tb('فقرة', 'formatBlock', 'P'),
    tb('↶', 'undo', null, 'تراجع'), tb('↷', 'redo', null, 'إعادة'), tb('✖ تنسيق', 'removeFormat'), size, tpl);
  const body = h('div', { class: 'editor-wrap' }, h('div', { class: 'editor-meta' }, title, sel, h('label', { class: 'chk' }, pub, ' نشر للعامة')), toolbar, area);

  area.addEventListener('input', () => { dirty = true; });
  title.addEventListener('input', () => { dirty = true; });
  const timer = setInterval(() => { if (dirty && !saved && !item) DB.kv.set('draft', { title: title.value, html: area.innerHTML, at: Date.now() }); }, 3000);

  const need = () => { if (!title.value.trim()) { toast('أدخل عنوان المستند', 'err'); title.focus(); return false; } return true; };
  const htmlNow = () => sanitizeHTML(area.innerHTML);
  const res = modal(item ? 'تعديل مستند' : 'محرر العرائض والمذكرات', body, [
    { label: 'إغلاق', value: null, onClick: async () => { if (dirty && !saved) return confirmBox('توجد تغييرات غير محفوظة. هل تريد الإغلاق؟', 'إغلاق بدون حفظ', true); } },
    { label: '🖨️ طباعة', keepOpen: true, onClick: () => printHTML(title.value || 'مستند', htmlNow()) },
    { label: '⬇️ تنزيل Word', keepOpen: true, onClick: () => { if (!need()) return; saveBlob(new Blob([`<html xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeHTML(title.value)}</title></head><body dir="rtl" style="font-family:'Traditional Arabic';font-size:16pt">${htmlNow()}</body></html>`], { type: 'application/msword' }), title.value.trim() + '.doc'); } },
    { label: '💾 حفظ في المكتبة', primary: true, onClick: async () => {
      if (!need()) return false;
      const t = typeOfCat(sel.value);
      const it = await L.saveItem({ id: item?.id, typeId: t.id, catId: sel.value, title: title.value.trim(), kind: 'doc', html: htmlNow(), pub: pub.checked, files: item?.files });
      saved = true; await DB.kv.del('draft'); textCache.clear(); ui.typeId = t.id; openItem(it.id); renderAdminBar(); toast('تم حفظ المستند في المكتبة');
    } },
  ], { full: true, sticky: true });
  res.then(() => clearInterval(timer));
}

/* ======================= السلة ======================= */
async function openTrash() {
  const box = h('div');
  const picked = new Set();
  const draw = () => {
    box.replaceChildren();
    const list = L.trashed();
    if (!list.length) { box.append(h('div', { class: 'empty', text: 'السلة فارغة.' })); return; }
    box.append(h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: (e) => { list.forEach((i) => (e.target.checked ? picked.add(i.id) : picked.delete(i.id))); draw(); }, checked: picked.size === list.length }), ' تحديد الكل'));
    for (const i of list) box.append(h('label', { class: 'trash-row' }, h('input', { type: 'checkbox', checked: picked.has(i.id), onchange: (e) => { e.target.checked ? picked.add(i.id) : picked.delete(i.id); } }),
      h('div', {}, h('div', { class: 'it-title', text: i.title }), h('div', { class: 'small', text: `${i.delFrom?.typeTitle || ''} › ${i.delFrom?.catTitle || ''} • حُذف ${fmtDate(i.deleted)}` }))));
  };
  draw();
  const need = () => { if (!picked.size) { toast('حدد عناصر أولاً', 'err'); return false; } return true; };
  await modal('🗑️ السلة', box, [
    { label: 'إغلاق', value: null },
    { label: '♻️ استعادة المحدد', primary: true, keepOpen: true, onClick: async () => { if (!need()) return; for (const id of picked) await L.restoreItem(id); toast(`تمت استعادة ${picked.size}`); picked.clear(); draw(); renderAll(); } },
    { label: 'حذف نهائي للمحدد', danger: true, keepOpen: true, onClick: async () => { if (!need() || !(await confirmBox(`حذف ${picked.size} عنصر نهائياً؟ لا يمكن التراجع.`, 'حذف نهائي', true))) return; for (const id of picked) await L.purgeItem(id); picked.clear(); textCache.clear(); draw(); renderAll(); toast('تم الحذف النهائي'); } },
    { label: 'تفريغ السلة', danger: true, keepOpen: true, onClick: async () => { const all = L.trashed(); if (!all.length || !(await confirmBox(`حذف كل عناصر السلة (${all.length}) نهائياً؟`, 'تفريغ', true))) return; for (const i of all) await L.purgeItem(i.id); picked.clear(); draw(); renderAll(); toast('تم تفريغ السلة'); } },
  ], { wide: true });
}

/* ======================= المزامنة والنشر (GitHub حقيقي) ======================= */
function ghCfg() {
  const g = S.settings.gh;
  if (!g.owner || !g.repo) { toast('اضبط مستودع GitHub من الإعدادات أولاً', 'err'); return null; }
  if (!session.token) { toast('أضف رمز GitHub من الإعدادات أولاً (يُحفظ مشفّراً بكلمة مرور الإدارة)', 'err'); return null; }
  return { owner: g.owner, repo: g.repo, branch: g.branch, token: session.token };
}
function progress() {
  const bar = h('div', { class: 'bar' }, h('i'));
  const txt = h('div', { class: 'small' });
  return { el: h('div', {}, txt, bar), set: (d, n, label) => { bar.firstChild.style.width = (n ? (d / n) * 100 : 0) + '%'; txt.textContent = label || `${d} / ${n}`; } };
}

async function openSync() {
  const g = S.settings.gh; const sy = S.settings.sync || {};
  const pubs = L.publishable();
  const info = h('div', { class: 'sync-info' },
    h('p', { text: `المستودع: ${g.owner}/${g.repo}${g.branch ? ' (' + g.branch + ')' : ''} — الرمز: ${session.token ? 'مُفعّل ✅' : 'غير مضاف ❌'}` }),
    h('p', { class: 'small', text: `آخر نشر: ${sy.lastPublish ? fmtDate(sy.lastPublish) : '—'} • آخر نسخة احتياطية: ${sy.lastBackup ? fmtDate(sy.lastBackup) : '—'}` }));
  const prog = progress();
  const act = (title, desc, label, fn, cls = 'neutral') => h('div', { class: 'sync-act' }, h('div', {}, h('strong', { text: title }), h('div', { class: 'small', text: desc })), h('button', { class: 'btn ' + cls, text: label, onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (err) { toast(err.message || String(err), 'err'); } finally { b.disabled = false; } } }));
  const body = h('div', {}, info,
    act('نشر المكتبة العامة', `ينشر ${pubs.length} عنصراً مُعلَّماً «للعامة» (نصوص + مرفقات) في data/ ليراها كل زائر للموقع. العناصر غير المعلَّمة لا تُنشر أبداً.`, 'نشر الآن', () => publishLibrary(prog), 'primary'),
    act('نسخة احتياطية مشفّرة', 'ترفع كل المكتبة (بما فيها الخاص) مشفّرة AES-256 بعبارة تضعها أنت إلى backup/. بدون العبارة لا يمكن لأحد قراءتها.', 'حفظ النسخة', () => backupToGitHub(prog)),
    act('استعادة من GitHub', 'تجلب النسخة المشفّرة وتدمجها أو تستبدل بها مكتبة هذا الجهاز.', 'استعادة', () => restoreFromGitHub(prog)),
    h('div', { class: 'small', text: 'الرمز المطلوب: Fine-grained Token بصلاحية Contents: Read and write على هذا المستودع فقط.' }), prog.el);
  await modal('☁️ المزامنة والنشر', body, [{ label: 'إغلاق', value: null }], { wide: true });
}

async function publishLibrary(prog) {
  const cfg = ghCfg(); if (!cfg) return;
  const { lib, files, count } = await L.buildPublish();
  const names = lib.items.slice(0, 12).map((i) => '• ' + i.title).join('\n') + (count > 12 ? `\n… و${count - 12} أخرى` : '');
  if (!count && !(await confirmBox('لا توجد عناصر منشورة: سيُنشر فهرس فارغ ويُحذف ما نُشر سابقاً. متابعة؟', 'متابعة', true))) return;
  if (count && !(await confirmBox(`سيصبح هذا المحتوى علنياً لكل من يزور الموقع:\n${names}`, `نشر ${count} عنصر`))) return;
  prog.set(0, 1, 'جارٍ التحضير…');
  const stale = await GH.listPaths(cfg, 'data/files/');
  for (const p of stale) if (!(p in files)) files[p] = null;
  const r = await GH.commitFiles(cfg, files, `نشر المكتبة (${count} عنصر)`, (d, n) => prog.set(d, n, `رفع الملفات ${d}/${n}`));
  S.settings.sync.lastPublish = Date.now(); await L.saveSettings();
  prog.set(1, 1, r.changed ? 'تم النشر. سيظهر للزوار خلال دقائق بعد بناء GitHub Pages.' : 'لا تغييرات للنشر.');
  toast(r.changed ? 'تم النشر بنجاح' : 'لا تغييرات للنشر');
}

async function askPass(title, confirmToo) {
  const fields = [{ name: 'p', label: 'عبارة التشفير', type: 'password', required: true, hint: confirmToo ? 'احفظها جيداً: لا يمكن استرجاع النسخة بدونها.' : undefined }];
  if (confirmToo) fields.push({ name: 'p2', label: 'تأكيد العبارة', type: 'password', required: true });
  const r = await form(title, fields, 'متابعة', { validate: (v) => (v.p.length < 8 ? 'العبارة قصيرة (8 أحرف على الأقل)' : confirmToo && v.p !== v.p2 ? 'العبارتان غير متطابقتين' : null) });
  return r?.p || null;
}
async function backupToGitHub(prog) {
  const cfg = ghCfg(); if (!cfg) return;
  const pass = await askPass('عبارة تشفير النسخة', true); if (!pass) return;
  prog.set(0, 1, 'جارٍ التشفير…');
  const text = await L.exportPackage(pass);
  if (text.length > 60 * 1024 * 1024) throw new Error('حجم النسخة كبير (> 60MB). أنقص المرفقات الكبيرة أو استخدم التصدير إلى ملف.');
  const r = await GH.commitFiles(cfg, { 'backup/library.enc.json': text }, 'نسخة احتياطية مشفّرة', (d, n) => prog.set(d, n));
  S.settings.sync.lastBackup = Date.now(); await L.saveSettings();
  prog.set(1, 1, `تم الرفع (${fmtSize(text.length)})`); toast(r.changed ? 'تم حفظ النسخة المشفّرة' : 'النسخة مطابقة لما في المستودع');
}
async function restoreFromGitHub(prog) {
  const cfg = ghCfg(); if (!cfg) return;
  prog.set(0, 1, 'جارٍ الجلب…');
  const text = await GH.readText(cfg, 'backup/library.enc.json');
  if (!text) throw new Error('لا توجد نسخة احتياطية في المستودع (backup/library.enc.json).');
  await importText(text); prog.set(1, 1, 'تمت الاستعادة');
}

/* ======================= الاستيراد/التصدير المحلي ======================= */
async function importText(text) {
  let pass = null, pkg;
  for (;;) {
    try { pkg = await L.parsePackage(text, pass); break; }
    catch (e) {
      if (e.needPass) { pass = await askPass('النسخة مشفّرة — أدخل العبارة', false); if (!pass) return; }
      else if (pass) { toast(e.message, 'err'); pass = await askPass('أعد إدخال العبارة', false); if (!pass) return; }
      else throw new Error(e.message.includes('JSON') ? 'الملف ليس JSON صالحاً' : e.message);
    }
  }
  const r = await form('استيراد النسخة', [{ name: 'mode', label: `تحتوي النسخة على ${pkg.items.length} عنصر. كيف تريد التطبيق؟`, type: 'select', value: 'merge', options: [{ value: 'merge', label: 'دمج (يبقى ما عندي، ويُحدَّث الأحدث)' }, { value: 'replace', label: 'استبدال كل مكتبة هذا الجهاز' }] }], 'استيراد');
  if (!r) return;
  if (r.mode === 'replace' && !(await confirmBox('سيُحذف كل ما في هذا الجهاز ويُستبدل بالنسخة. متابعة؟', 'استبدال', true))) return;
  const n = await L.applyPackage(pkg, r.mode); textCache.clear(); ui.cur = null; renderAll(); toast(`تم استيراد ${n} عنصر`);
}
async function importFromFile() {
  const inp = h('input', { type: 'file', accept: 'application/json,.json' });
  inp.onchange = async () => { try { await importText(await inp.files[0].text()); } catch (e) { toast(e.message, 'err'); } };
  inp.click();
}
async function exportToFile() {
  const r = await form('تصدير نسخة كاملة', [{ name: 'p', label: 'عبارة تشفير (اتركها فارغة لنسخة غير مشفّرة)', type: 'password' }], 'تصدير');
  if (!r) return;
  if (r.p && r.p.length < 8) return toast('عبارة التشفير قصيرة (8 أحرف على الأقل)', 'err');
  const text = await L.exportPackage(r.p || '');
  saveBlob(new Blob([text], { type: 'application/json' }), `maktabat-alaisai-${new Date().toISOString().slice(0, 10)}${r.p ? '.enc' : ''}.json`);
  toast('تم التصدير' + (r.p ? ' (مشفّر)' : ' — الملف غير مشفّر!'), r.p ? 'ok' : 'err');
}
async function importRemote() {
  try { const n = await L.importRemote(); renderAll(); toast(`تم استيراد ${n} عنصر من المكتبة المنشورة`); } catch (e) { toast(e.message, 'err'); }
}

/* ======================= الإعدادات ======================= */
async function openSettings() {
  const btn = (label, fn, cls = 'neutral') => h('button', { class: 'btn ' + cls + ' wide', text: label, onclick: fn });
  const body = h('div', { class: 'settings' },
    h('h4', { text: 'الحماية' }), btn('تغيير كلمة المرور', changePassword),
    h('h4', { text: 'التواصل (يظهر للزوار)' }), btn('رقم واتساب / بريد الإدارة', contactSettings),
    h('h4', { text: 'ربط GitHub' }), btn('المستودع والرمز', githubSettings),
    h('h4', { text: 'النسخ' }), btn('تصدير نسخة كاملة (ملف)', exportToFile), btn('استيراد نسخة من ملف', importFromFile), btn('استيراد المكتبة المنشورة إلى جهازي', importRemote),
    h('h4', { text: 'منطقة الخطر' }), btn('مسح كل بيانات هذا الجهاز', async () => { if (await confirmBox('سيُمسح كل شيء على هذا الجهاز: المكتبة، السلة، الإعدادات، كلمة المرور. تأكد من وجود نسخة احتياطية.', 'مسح كل شيء', true)) { await L.eraseEverything(); location.reload(); } }, 'danger'));
  await modal('⚙️ الإعدادات', body, [{ label: 'إغلاق', value: null }]);
}
async function changePassword() {
  const r = await form('تغيير كلمة المرور', [
    { name: 'old', label: 'كلمة المرور الحالية', type: 'password', required: true },
    { name: 'p1', label: 'الجديدة (6 أحرف فأكثر)', type: 'password', required: true },
    { name: 'p2', label: 'تأكيد الجديدة', type: 'password', required: true }],
  'تغيير', { validate: async (v) => (v.p1.length < 6 ? 'قصيرة (6 أحرف على الأقل)' : v.p1 !== v.p2 ? 'غير متطابقتين' : !(await verifyPassword(v.old, S.admin)) ? 'كلمة المرور الحالية غير صحيحة' : null) });
  if (!r) return;
  await L.saveAdmin(await hashPassword(r.p1));
  if (session.token) { S.settings.gh.tokenEnc = await encrypt(session.token, r.p1); await L.saveSettings(); } // أعد تشفير الرمز بالكلمة الجديدة
  session.pw = r.p1; toast('تم تغيير كلمة المرور');
}
async function contactSettings() {
  const c = S.settings.contact;
  const r = await form('وسائل التواصل', [
    { name: 'whatsapp', label: 'رقم واتساب بالصيغة الدولية (أرقام فقط، مثال 967771234567)', value: c.whatsapp, dir: 'ltr' },
    { name: 'email', label: 'البريد الإلكتروني', type: 'email', value: c.email, dir: 'ltr' }], 'حفظ',
  { validate: (v) => (v.whatsapp && !/^\d{8,15}$/.test(v.whatsapp.replace(/[\s+()-]/g, '')) ? 'رقم واتساب غير صالح' : null) });
  if (!r) return;
  S.settings.contact = { whatsapp: r.whatsapp.replace(/[^\d]/g, ''), email: r.email.trim() }; await L.saveSettings(); renderContact();
  toast('تم الحفظ. انشر المكتبة ليراها الزوار.');
}
async function githubSettings() {
  const g = S.settings.gh;
  const r = await form('ربط GitHub', [
    { name: 'owner', label: 'اسم الحساب (Owner)', value: g.owner, required: true, dir: 'ltr' },
    { name: 'repo', label: 'اسم المستودع', value: g.repo, required: true, dir: 'ltr' },
    { name: 'branch', label: 'الفرع (اتركه فارغاً للافتراضي)', value: g.branch, dir: 'ltr' },
    { name: 'token', label: session.token ? 'رمز جديد (اتركه فارغاً للإبقاء على الحالي)' : 'رمز الوصول (Fine-grained token)', type: 'password', dir: 'ltr', hint: 'يُحفظ على هذا الجهاز مشفّراً بكلمة مرور الإدارة ولا يُرسل لأي جهة سوى api.github.com.' }],
  'حفظ واختبار');
  if (!r) return;
  Object.assign(S.settings.gh, { owner: r.owner.trim(), repo: r.repo.trim(), branch: r.branch.trim() });
  if (r.token.trim()) { session.token = r.token.trim(); S.settings.gh.tokenEnc = await encrypt(session.token, session.pw); }
  await L.saveSettings();
  if (!session.token) return toast('تم حفظ المستودع. أضف الرمز للمزامنة.');
  try { const t = await GH.testConnection({ ...S.settings.gh, token: session.token }); toast(`اتصال ناجح بـ ${t.full} (الفرع ${t.branch})`); } catch (e) { toast(e.message, 'err'); }
}

/* ======================= مراسلة الإدارة (قنوات حقيقية) ======================= */
function renderContact() {
  const c = L.contact();
  $('send-wa').classList.toggle('dim', !c.whatsapp); $('send-mail').classList.toggle('dim', !c.email);
  $('contact-hint').textContent = c.whatsapp || c.email ? 'تُرسل الرسالة عبر واتساب أو البريد إلى الإدارة. يُحفظ سجل بما أرسلته على جهازك فقط.' : 'لم تُضبط وسيلة تواصل بعد.';
}
async function sendVisitor(channel) {
  const name = $('visitor-name').value.trim(), msg = $('visitor-message').value.trim(), files = Array.from($('visitor-files').files);
  if (msg.length < 2 && !files.length) return toast('اكتب رسالة أو أرفق ملفاً', 'err');
  const c = L.contact();
  if (!(channel === 'wa' ? c.whatsapp : c.email)) {
    const label = channel === 'wa' ? 'واتساب' : 'البريد';
    if (ui.admin) { if (await confirmBox(`لم تضبط ${label} بعد. هل تفتح إعدادات التواصل الآن؟`, 'فتح الإعدادات')) contactSettings(); return; }
    return infoBox('غير متاح حالياً', `وسيلة التواصل عبر ${label} غير مفعّلة من الإدارة بعد. جرّب الوسيلة الأخرى أو أعد المحاولة لاحقاً.`);
  }
  const text = (name ? `الاسم: ${name}\n` : '') + msg;
  let sent = false;
  if (files.length && navigator.canShare?.({ files })) {
    try { await navigator.share({ files, text, title: 'مراسلة مكتبة العيسائي القانونية' }); sent = true; } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (!sent) {
    if (channel === 'wa') window.open(`https://wa.me/${c.whatsapp}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else location.href = `mailto:${c.email}?subject=${encodeURIComponent('مراسلة من مكتبة العيسائي القانونية')}&body=${encodeURIComponent(text)}`;
    if (files.length) infoBox('المرفقات', 'متصفحك لا يدعم إرسال الملفات تلقائياً. أرفق الملفات يدوياً داخل المحادثة/البريد بعد فتحه.');
  }
  await L.logAdd({ name, message: msg, files: files.map((f) => f.name), channel });
  $('visitor-message').value = ''; $('visitor-files').value = ''; toast('تم فتح قناة الإرسال وحفظ السجل'); renderAdminBar();
}
async function openLog() {
  const list = await L.logAll();
  const box = h('div');
  if (!list.length) box.append(h('div', { class: 'empty', text: 'لا توجد رسائل مرسلة من هذا الجهاز.' }));
  for (const m of list) box.append(h('div', { class: 'log-row' }, h('div', { class: 'small', text: `${fmtDate(m.created)} • ${m.channel === 'wa' ? 'واتساب' : m.channel === 'mail' ? 'بريد' : m.channel}${m.name ? ' • ' + m.name : ''}` }), h('div', { class: 't', text: m.message }),
    m.files?.length ? h('div', { class: 'small', text: '📎 ' + m.files.join('، ') }) : null,
    h('button', { class: 'btn danger', text: 'حذف', onclick: async (e) => { await L.logDel(m.id); e.currentTarget.closest('.log-row').remove(); } })));
  await modal('📥 الرسائل المرسلة من هذا الجهاز', box, [{ label: 'مسح الكل', danger: true, onClick: async () => { if (!list.length || !(await confirmBox('مسح سجل الرسائل؟', 'مسح', true))) return false; await L.logClear(); } }, { label: 'إغلاق', value: null }], { wide: true });
}

/* ======================= أزرار العارض ======================= */
function curItem() { return ui.cur ? L.getItem(ui.cur) : null; }
function itemAsText(it) { return `${it.title}\n\n${plain(it)}`; }
$('btn-copy-selected').addEventListener('click', async () => { const it = curItem(); if (!it) return; try { await navigator.clipboard.writeText(itemAsText(it)); toast('تم النسخ'); } catch { toast('تعذّر النسخ', 'err'); } });
$('btn-download-selected').addEventListener('click', () => {
  const it = curItem(); if (!it) return;
  const name = it.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'document';
  if (it.kind === 'doc') saveBlob(new Blob([`<html><head><meta charset="utf-8"></head><body dir="rtl" style="font-family:'Traditional Arabic';font-size:16pt">${sanitizeHTML(it.html)}</body></html>`], { type: 'application/msword' }), name + '.doc');
  else saveBlob(new Blob([itemAsText(it)], { type: 'text/plain;charset=utf-8' }), name + '.txt');
});
$('btn-print-selected').addEventListener('click', () => {
  const it = curItem(); if (!it) return;
  printHTML(it.title, `<h2>${escapeHTML(it.title)}</h2>` + (it.kind === 'doc' ? sanitizeHTML(it.html) : `<div class="t">${escapeHTML(it.text || '')}</div>`));
});
$('btn-share-selected').addEventListener('click', async () => {
  const it = curItem(); if (!it) return;
  const url = location.origin + location.pathname + '#i=' + encodeURIComponent(it.id);
  if (navigator.share) { try { await navigator.share({ title: it.title, text: plain(it).slice(0, 500), url }); } catch { /* ألغى المستخدم */ } }
  else { await navigator.clipboard?.writeText(url).catch(() => {}); toast('تم نسخ رابط العنصر'); }
});
$('btn-edit-selected').addEventListener('click', () => { const it = curItem(); if (it && !it.remote) editItem(it); else if (it) importRemote(); });

/* ======================= البحث / التثبيت / الإقلاع ======================= */
$('search').addEventListener('input', (e) => { ui.q = e.target.value; renderTree(); });
$('btn-admin').addEventListener('click', async () => { if (ui.admin) { openSettings(); } else await requireAdmin(); });
$('send-wa').addEventListener('click', () => sendVisitor('wa'));
$('send-mail').addEventListener('click', () => sendVisitor('mail'));
$('btn-view-uploads').addEventListener('click', openLog);

const VERSION = '2.1.1';
const FS_KEY = 'alaisai_vf';
function setFont(px) {
  px = Math.max(13, Math.min(28, px));
  document.documentElement.style.setProperty('--vf', px + 'px');
  try { localStorage.setItem(FS_KEY, String(px)); } catch { /* التخزين غير متاح */ }
  return px;
}
let fontPx = 16;
try { fontPx = Number(localStorage.getItem(FS_KEY)) || 16; } catch { /* تجاهل */ }
setFont(fontPx);
$('btn-font-up').addEventListener('click', () => { fontPx = setFont(fontPx + 2); });
$('btn-font-down').addEventListener('click', () => { fontPx = setFont(fontPx - 2); });

let deferred = null;
const installBtn = $('btn-install');
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
if (isStandalone()) installBtn.classList.add('hidden');
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
window.addEventListener('appinstalled', () => { installBtn.classList.add('hidden'); toast('تم تثبيت التطبيق'); });
installBtn.addEventListener('click', async () => {
  if (deferred) { deferred.prompt(); const r = await deferred.userChoice; deferred = null; if (r.outcome === 'accepted') installBtn.classList.add('hidden'); return; }
  const ios = /iphone|ipad/i.test(navigator.userAgent);
  infoBox('تثبيت التطبيق', ios
    ? 'في سفاري: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».'
    : 'في كروم: افتح قائمة المتصفح (⋮) ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية». إن لم يظهر الخيار فقد يكون التطبيق مثبّتاً أصلاً على هذا الجهاز.');
});

const netBadge = () => ($('net').textContent = navigator.onLine ? '' : '⚠️ غير متصل — تعمل المكتبة من النسخة المحفوظة');
addEventListener('online', netBadge); addEventListener('offline', netBadge);

function fromHash() { if (location.hash === '#search') { $('search').focus(); return; } const m = location.hash.match(/^#i=(.+)$/); if (m) { const id = decodeURIComponent(m[1]); if (L.getItem(id)) openItem(id); } }
addEventListener('hashchange', fromHash);

function sessionStorageFlag() { try { return sessionStorage.getItem('alaisai_upd') === '1'; } catch { return false; } }

(async function boot() {
  $('year').textContent = new Date().getFullYear(); $('ver').textContent = VERSION;
  try { await L.init(); } catch (e) { document.body.prepend(h('div', { class: 'fatal', text: 'تعذّر فتح قاعدة بيانات المتصفح: ' + e.message + ' (قد يكون الوضع الخاص مفعّلاً).' })); return; }
  ui.typeId = S.tree.types[0]?.id; renderAll(); fromHash(); netBadge();
  if (await L.loadRemote()) { renderAll(); fromHash(); }
  if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading && sessionStorageFlag()) { reloading = true; location.reload(); } });
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      const offer = async (w) => {
        if (!(await confirmBox('يتوفر إصدار أحدث من التطبيق. هل تريد التحديث الآن؟ (لن تتأثر بياناتك)', 'تحديث الآن'))) return;
        try { sessionStorage.setItem('alaisai_upd', '1'); } catch { /* تجاهل */ }
        w.postMessage('SKIP_WAITING');
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); }); });
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});
  }
})();
