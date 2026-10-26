/* أدوات الواجهة: بناء DOM آمن، إشعارات، حوارات (بديل prompt/alert/confirm) */

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

/* ---------- إشعار عابر ---------- */
let toastTimer;
export function toast(msg, kind = 'ok') {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.append(t); }
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), kind === 'err' ? 6000 : 2800);
}

/* ---------- حوار عام ---------- */
export function modal(title, content, buttons = [], opts = {}) {
  const dlg = h('dialog', { class: 'dlg' + (opts.wide ? ' wide' : '') + (opts.full ? ' full' : '') });
  const close = (val) => { if (dlg.open) dlg.close(); dlg.remove(); dlg._resolve?.(val); };
  const head = h('div', { class: 'dlg-head' }, h('h3', { text: title }), h('button', { class: 'icon-btn', 'aria-label': 'إغلاق', text: '✖', onclick: () => close(null) }));
  const foot = buttons.length
    ? h('div', { class: 'dlg-foot' }, buttons.map((b) =>
        h('button', {
          class: 'btn ' + (b.primary ? 'primary' : b.danger ? 'danger' : 'neutral'),
          text: b.label,
          onclick: async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const r = await b.onClick?.(close);
              if (r !== false && !b.keepOpen) close(b.value ?? true);
            } finally { btn.disabled = false; }
          },
        })))
    : null;
  dlg.append(head, h('div', { class: 'dlg-body' }, content), foot);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && !opts.sticky) close(null); });
  document.body.append(dlg);
  dlg.showModal();
  const p = new Promise((r) => (dlg._resolve = r));
  p.close = close;
  p.el = dlg;
  return p;
}

export function confirmBox(message, okLabel = 'تأكيد', danger = false) {
  return modal('تأكيد', h('p', { text: message }), [
    { label: 'إلغاء', value: false },
    { label: okLabel, primary: !danger, danger, value: true },
  ]).then((v) => v === true);
}

export function infoBox(title, message) {
  return modal(title, typeof message === 'string' ? h('p', { text: message }) : message, [{ label: 'حسناً', primary: true }]);
}

/* نموذج: fields = [{name,label,type,value,options,placeholder,required,multiple,hint,rows}] */
export function form(title, fields, okLabel = 'حفظ', opts = {}) {
  const inputs = {};
  const body = h('form', { class: 'frm', onsubmit: (e) => e.preventDefault() });
  for (const f of fields) {
    let el;
    if (f.type === 'textarea') el = h('textarea', { rows: f.rows || 6, placeholder: f.placeholder || '', value: f.value ?? '' });
    else if (f.type === 'select') el = h('select', {}, f.options.map((o) => h('option', { value: o.value, text: o.label, selected: o.value === f.value })));
    else if (f.type === 'checkbox') el = h('input', { type: 'checkbox', checked: !!f.value });
    else if (f.type === 'file') el = h('input', { type: 'file', multiple: !!f.multiple, accept: f.accept });
    else el = h('input', { type: f.type || 'text', placeholder: f.placeholder || '', value: f.value ?? '', autocomplete: f.type === 'password' ? 'off' : undefined, dir: f.dir });
    inputs[f.name] = el;
    const lab = h('label', { class: f.type === 'checkbox' ? 'chk' : '' }, f.type === 'checkbox' ? [el, ' ', f.label] : [h('span', { text: f.label }), el]);
    body.append(lab);
    if (f.hint) body.append(h('div', { class: 'small', text: f.hint }));
  }
  if (opts.extra) body.append(opts.extra);
  const read = () => {
    const v = {};
    for (const f of fields) {
      const el = inputs[f.name];
      v[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'file' ? Array.from(el.files) : el.value;
    }
    return v;
  };
  let result = null;
  const p = modal(title, body, [
    { label: 'إلغاء', value: null },
    {
      label: okLabel, primary: true,
      onClick: async () => {
        const v = read();
        for (const f of fields) {
          if (f.required && (f.type === 'file' ? !v[f.name].length : !String(v[f.name]).trim())) {
            toast(`الحقل مطلوب: ${f.label}`, 'err');
            inputs[f.name].focus();
            return false;
          }
        }
        if (opts.validate) { const m = await opts.validate(v); if (m) { toast(m, 'err'); return false; } }
        result = v;
        return true;
      },
    },
  ], opts);
  setTimeout(() => inputs[fields[0]?.name]?.focus(), 30);
  return p.then(() => result);
}

export const prompt2 = (title, label, value = '', extra = {}) =>
  form(title, [{ name: 'v', label, value, required: true, ...extra }]).then((r) => (r ? r.v.trim() : null));

/* ---------- قائمة سياقية ---------- */
let menuEl;
export function showMenu(anchor, entries) {
  hideMenu();
  menuEl = h('div', { class: 'menu', role: 'menu' }, entries.filter(Boolean).map((e) =>
    h('button', { role: 'menuitem', class: e.danger ? 'danger-text' : '', text: e.label, onclick: () => { hideMenu(); e.action(); } })));
  document.body.append(menuEl);
  const r = anchor.getBoundingClientRect();
  const w = menuEl.offsetWidth, hh = menuEl.offsetHeight;
  let x = r.left; if (x + w > innerWidth - 8) x = innerWidth - w - 8; if (x < 8) x = 8;
  let y = r.bottom + 4; if (y + hh > innerHeight - 8) y = Math.max(8, r.top - hh - 4);
  menuEl.style.left = x + 'px';
  menuEl.style.top = y + 'px';
  menuEl.querySelector('button')?.focus();
}
export function hideMenu() { menuEl?.remove(); menuEl = null; }
document.addEventListener('click', (e) => { if (menuEl && !e.target.closest('.menu') && !e.target.closest('[data-menu]')) hideMenu(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); });

/* ---------- تنزيل / نسخ / طباعة ---------- */
export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function printHTML(title, bodyHtml) {
  const f = h('iframe', { style: { position: 'fixed', width: '0', height: '0', border: '0', visibility: 'hidden' }, 'aria-hidden': 'true' });
  document.body.append(f);
  const d = f.contentDocument;
  d.open();
  d.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title></title>
<style>body{font-family:'Traditional Arabic','Times New Roman',serif;font-size:18px;line-height:2;color:#000;padding:24px}h1,h2,h3{text-align:center}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:4px}.t{white-space:pre-wrap}</style></head><body></body></html>`);
  d.close();
  d.title = title;
  d.body.innerHTML = bodyHtml;
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 2000); }, 150);
}

/* بحث عربي: توحيد الأحرف وإزالة التشكيل مع الحفاظ على خريطة المواضع للتظليل */
export function norm(str) {
  return normMap(str).n;
}
export function normMap(str) {
  const s = String(str ?? '');
  let n = '';
  const map = [];
  for (let i = 0; i < s.length; i++) {
    let c = s[i];
    if (/[ً-ٰٟـ]/.test(c)) continue;
    if ('إأآٱ'.includes(c)) c = 'ا';
    else if (c === 'ى') c = 'ي';
    else if (c === 'ؤ') c = 'و';
    else if (c === 'ئ') c = 'ي';
    else if (c === 'ة') c = 'ه';
    else c = c.toLowerCase();
    n += c;
    map.push(i);
  }
  return { n, map };
}

/* يعيد عقدة نصية مع <mark> دون innerHTML */
export function highlight(text, q) {
  const frag = document.createDocumentFragment();
  const nq = norm(q).trim();
  if (!nq) { frag.append(text); return frag; }
  const { n, map } = normMap(text);
  let last = 0, from = 0, i;
  while ((i = n.indexOf(nq, from)) !== -1) {
    const start = map[i];
    const end = (map[i + nq.length - 1] ?? text.length - 1) + 1;
    if (start >= last) {
      frag.append(text.slice(last, start), h('mark', { text: text.slice(start, end) }));
      last = end;
    }
    from = i + nq.length;
  }
  frag.append(text.slice(last));
  return frag;
}

export const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
export const fmtDate = (t) => new Date(t).toLocaleString('ar', { dateStyle: 'medium', timeStyle: 'short' });
