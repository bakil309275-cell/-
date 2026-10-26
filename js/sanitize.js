/* تعقيم HTML بقائمة بيضاء — يمنع XSS في المستندات والنصوص */
const ALLOWED = new Set(['P','DIV','SPAN','B','STRONG','I','EM','U','S','BR','H1','H2','H3','H4','UL','OL','LI','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TD','TH','HR','FONT','SUB','SUP']);
const DROP_WITH_CONTENT = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','LINK','META','SVG','MATH','FORM','INPUT','TEXTAREA','BUTTON','TEMPLATE','NOSCRIPT']);
const SAFE_CSS = /^(text-align|font-size|font-weight|font-style|text-decoration|text-decoration-line|direction|line-height|margin-right|margin-left|padding-right|padding-left)$/;
const SAFE_VAL = /^[\w\s.,%#()\-+]*$/;

function cleanStyle(el) {
  const keep = [];
  for (const prop of Array.from(el.style)) {
    const val = el.style.getPropertyValue(prop);
    if (SAFE_CSS.test(prop) && SAFE_VAL.test(val)) keep.push(`${prop}:${val}`);
  }
  el.removeAttribute('style');
  if (keep.length) el.setAttribute('style', keep.join(';'));
}

function walk(node) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) continue;
    if (child.nodeType !== 1) { child.remove(); continue; }
    if (DROP_WITH_CONTENT.has(child.tagName)) { child.remove(); continue; }
    walk(child);
    if (!ALLOWED.has(child.tagName)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const a of Array.from(child.attributes)) {
      const n = a.name.toLowerCase();
      if (n === 'style') continue;
      if ((n === 'dir' && /^(rtl|ltr)$/i.test(a.value)) || (n === 'align' && /^(right|left|center|justify)$/i.test(a.value))) continue;
      if (child.tagName === 'FONT' && n === 'size' && /^[1-7]$/.test(a.value)) continue;
      child.removeAttribute(a.name);
    }
    if (child.hasAttribute('style')) cleanStyle(child);
  }
}

export function sanitizeHTML(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  walk(doc.body);
  return doc.body.innerHTML;
}

export const escapeHTML = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
