/* js/app.js - Maktabat AlAysaei (vFinal)
   - يعمل أوفلاين (IndexedDB + service worker)
   - شريط أيقونات قابل للإضافة بالعربي
   - لوحة ضبط محمية بكلمة مرور (تعيين أول مرة + تغيير + إعادة ضبط)
*/

const META_KEY = 'maktabat_alaysaei_meta_vfinal';
const ADMIN_KEY = 'maktabat_alaysaei_admin_vfinal';
const DB_NAME = 'maktabat_alaysaei_db_vfinal';
const TRASH_KEY = 'maktabat_alaysaei_trash_vfinal'; // أضيف
window.trash = JSON.parse(localStorage.getItem(TRASH_KEY) || '[]'); // أضيف
function saveTrash() { localStorage.setItem(TRASH_KEY, JSON.stringify(window.trash)); } // أضيف
const DB_VER = 1;
const FILE_STORE = 'files';
const UPLOAD_STORE = 'uploads';
const btnCopySelected = document.getElementById('btn-copy-selected');

/* IndexedDB helper */
function openDB(){ return new Promise((res,rej)=>{ const rq = indexedDB.open(DB_NAME, DB_VER); rq.onupgradeneeded = e => { const db = e.target.result; if(!db.objectStoreNames.contains(FILE_STORE)) db.createObjectStore(FILE_STORE,{keyPath:'id'}); if(!db.objectStoreNames.contains(UPLOAD_STORE)) db.createObjectStore(UPLOAD_STORE,{keyPath:'id'}); }; rq.onsuccess = ()=> res(rq.result); rq.onerror = ()=> rej(rq.error); }); }
async function saveFileToDB(id,file,store=FILE_STORE){ const db = await openDB(); return new Promise((res,rej)=>{ const tx=db.transaction(store,'readwrite'); tx.objectStore(store).put({id,file,name:file.name||'file_'+id,type:file.type||'',size:file.size||0,created:Date.now()}); tx.oncomplete=res; tx.onerror=rej; }); }
async function getFileFromDB(id,store=FILE_STORE){ const db = await openDB(); return new Promise((res,rej)=>{ const rq=db.transaction(store).objectStore(store).get(id); rq.onsuccess = ()=> res(rq.result?.file||null); rq.onerror = ()=> rej(rq.error); }); }
async function listAllFilesMeta(store=FILE_STORE){ const db = await openDB(); return new Promise((res,rej)=>{ const out=[]; const rq = db.transaction(store).objectStore(store).openCursor(); rq.onsuccess = e => { const cur = e.target.result; if(!cur){ res(out); return; } out.push({id:cur.value.id,name:cur.value.name,size:cur.value.size,type:cur.value.type,created:cur.value.created}); cur.continue(); }; rq.onerror = ()=> rej(rq.error); }); }

/* Load / save meta (types/icons/categories/examples) */
let meta = loadMeta();
function loadMeta(){ try{ const raw = localStorage.getItem(META_KEY); if(raw) return JSON.parse(raw); }catch(e){ console.warn(e); } return { types: [] }; }
function saveMeta(){ localStorage.setItem(META_KEY, JSON.stringify(meta)); renderTopStrip(); renderPublicIndex(); renderAdminIndex(); alert('✅ تم حفظ التعديلات'); }

/* Defaults (if first run) */
function ensureDefaults(){
  if(meta.types && meta.types.length>0) return;
  meta.types = [
    { id:'models', icon:'📄', title:'النماذج', categories:[] },
    { id:'books', icon:'📚', title:'الكتب', categories:[] },
    { id:'videos', icon:'🎥', title:'الفيديوهات', categories:[] },
    { id:'templates', icon:'🧾', title:'الصيغ', categories:[] },
    { id:'laws', icon:'⚖️', title:'القوانين', categories:[] },
    { id:'records', icon:'📂', title:'المذكرات', categories:[] }
  ];
  // add example category/example to show UI
  meta.types[0].categories.push({ title:'العقود المدنية', examples:[ { title:'عقد بيع ابتدائي', text:'[نموذج عقد بيع ابتدائي]' } ] });
  saveMeta();
}

/* Top strip rendering (icons can be added in Arabic) */
const topIconsRoot = document.getElementById('top-icons');
function renderTopStrip(){
  topIconsRoot.innerHTML = '';
  meta.types.forEach((t,ti)=>{
    const el = document.createElement('div');
    el.className = 'strip-item';
    el.dataset.typeId = t.id;
    el.innerHTML = `<span style="font-size:18px">${t.icon}</span><span style="font-weight:700;margin-right:6px">${t.title}</span><span class="dots" style="margin-left:6px;cursor:pointer">⋮</span>`;
    el.addEventListener('click', (e)=>{
      if(e.target.classList && e.target.classList.contains('dots')){ openTypeMenu(e,t,el); return; }
      openType(t.id);
    });
    topIconsRoot.appendChild(el);
  });
}

/* Context menu for top icon (three dots) */
const ctxMenu = document.getElementById('context-menu');
function openTypeMenu(ev,t,btnEl){
  ev.stopPropagation();
  const rect = btnEl.getBoundingClientRect();
  const items = [
    { label:'تعديل عنوان الأيقونة', action:()=>{ const v = prompt('العنوان الجديد:', t.title); if(v){ t.title = v; saveMeta(); } } },
    { label:'تعديل أيقونة (إيموجي أو نص)', action:()=>{ const v = prompt('الأيقونة (إيموجي أو حرف):', t.icon); if(v){ t.icon=v; saveMeta(); } } },
    { label:'إضافة قسم جديد', action:()=>{ const v = prompt('اسم القسم:'); if(v){ t.categories.push({ title:v, examples:[] }); saveMeta(); openType(t.id); } } },
    { label:'حذف الأيقونة وكافة محتواها', action:()=>{ if(confirm('حذف الأيقونة وكل ما تحويه؟')){ const idx = meta.types.findIndex(x=>x.id===t.id); if(idx>=0){ meta.types.splice(idx,1); saveMeta(); } } } },
    { label:'إعادة تسمية الأيقونة', action:()=>{ const v=prompt('اسم جديد:', t.title); if(v){ t.title=v; saveMeta(); } } }
  ];
  showMenuAt(rect.right-10, rect.bottom+6, items);
}

/* Generic menu helpers */
function showMenuAt(x,y,items){
  ctxMenu.style.left = x + 'px'; ctxMenu.style.top = y + 'px'; ctxMenu.innerHTML=''; items.forEach(it=>{ const b = document.createElement('button'); b.textContent = it.label; b.onclick = ()=>{ it.action(); hideMenu(); }; ctxMenu.appendChild(b); }); ctxMenu.style.display='block';
}
function hideMenu(){ ctxMenu.style.display='none'; }
window.addEventListener('click',(e)=>{ if(!e.target.closest('.strip-item') && !e.target.closest('.menu') && !e.target.closest('.dots')) hideMenu(); });

/* Open a type (show its categories & examples in the index) */
const publicIndexRoot = document.getElementById('public-index-root');
let activeTypeId = null;
function openType(typeId){
  activeTypeId = typeId;
  renderPublicIndex();
}

function normalizeText(txt){
  return (txt || '')
    .toLowerCase()
    .replace(/[إأآا]/g,'ا')
    .replace(/ى/g,'ي')
    .replace(/ؤ/g,'و')
    .replace(/ئ/g,'ي')
    .replace(/ة/g,'ه')
    .replace(/\s+/g,' ')
    .trim();
}

function highlight(text, q){
  if(!q) return text;
  const safe = q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re = new RegExp(`(${safe})`,'gi');
  return text.replace(re,'<mark>$1</mark>');
}

/* Render public index with triangles and counts and example three-dot menus */
function renderPublicIndex(){
  publicIndexRoot.innerHTML = '';
  const q = normalizeText(document.getElementById('search').value);
  const t = meta.types.find(x=>x.id===activeTypeId) || meta.types[0];
  if(!t) return publicIndexRoot.innerHTML = '<div class="small">لا توجد أيقونات</div>';
  
  t.categories.forEach((cat,ci)=>{
    const catMatch = normalizeText(cat.title).includes(q);
    const matchedExamples = cat.examples.filter(ex=>{
      return normalizeText(ex.title).includes(q) || (ex.text && normalizeText(ex.text).includes(q));
    });

    if(q && !catMatch && matchedExamples.length === 0) return;

    const isSearchActive = q.length > 0;

    const catEl = document.createElement('div'); 
    catEl.className = `cat ${!isSearchActive ? 'collapsed' : ''}`;
    
    const row = document.createElement('div'); 
    row.className = 'cat-row parent';
    row.style.cursor = 'pointer';

    const tri = document.createElement('span'); 
    tri.className = 'toggle-icon'; 
    tri.style.display = 'inline-block';
    tri.style.transition = '0.3s';
    tri.style.marginLeft = '10px';
    tri.textContent = '▼';
    tri.style.transform = !isSearchActive ? 'rotate(-90deg)' : 'rotate(0deg)';

    const title = document.createElement('div'); 
    title.style.flex = '1'; 
    title.style.fontWeight = 'bold';
    title.style.color = 'var(--accent)';
    title.textContent = cat.title;

    const count = document.createElement('div'); 
    count.className = 'small'; 
    count.style.opacity = '0.6';
    count.textContent = `[${cat.examples.length}]`;

    const options = document.createElement('div'); 
    options.innerHTML = `<span class="dots" style="padding:0 10px">⋮</span>`; 
    options.onclick = (e)=>{ e.stopPropagation(); openCategoryMenu(e,t,cat); };

    row.appendChild(tri); 
    row.appendChild(title); 
    row.appendChild(count); 
    row.appendChild(options);
    catEl.appendChild(row);

    const body = document.createElement('div'); 
    body.className = `sub-list children-container ${!isSearchActive ? 'hidden' : ''}`;
    body.style.marginRight = '20px';
    body.style.borderRight = '2px solid var(--line)';
    body.style.paddingRight = '10px';
    body.style.display = !isSearchActive ? 'none' : 'block';

    row.onclick = () => {
      const isHidden = body.style.display === 'none';
      body.style.display = isHidden ? 'block' : 'none';
      tri.style.transform = isHidden ? 'rotate(0deg)' : 'rotate(-90deg)';
    };

    const targetList = matchedExamples.length ? matchedExamples : cat.examples;
    targetList.forEach((ex, ei)=>{
      const realIndex = cat.examples.indexOf(ex);
      const exDiv = document.createElement('div'); 
      exDiv.className = 'example-item child';
      exDiv.style.padding = '8px';
      exDiv.style.borderBottom = '1px dashed rgba(255,255,255,0.05)';
      
      exDiv.innerHTML = `
        <div style="text-align:right;flex:1">📄 ${highlight(ex.title, q)}</div>
        <div style="display:flex;gap:6px">
          <button class="icon-btn" onclick="openExample('${t.id}',${ci},${realIndex})">عرض</button>
          <button class="icon-btn" onclick="openExampleMenu(event,'${t.id}',${ci},${realIndex})">⋮</button>
        </div>
      `;
      body.appendChild(exDiv);
    });

    catEl.appendChild(body);
    publicIndexRoot.appendChild(catEl);
  });
}

/* Category menu (add/rename/delete) */
function openCategoryMenu(e,t,cat){
  const rect = e.target.getBoundingClientRect();
  const items = [
    { label:'إعادة تسمية القسم', action:()=>{ const v = prompt('الاسم الجديد:', cat.title); if(v){ cat.title=v; saveMeta(); renderPublicIndex(); } } },
    { label:'إضافة نموذج جديد', action:()=>{ const title = prompt('عنوان النموذج:'); if(!title) return; const text = prompt('نص النموذج:')||''; cat.examples.push({title,text,files:[]}); saveMeta(); renderPublicIndex(); } } },
    { label:'حذف القسم', action:()=>{ if(confirm('حذف القسم وكافة النماذج؟')){ const idx = t.categories.indexOf(cat); if(idx>=0){ t.categories.splice(idx,1); saveMeta(); renderPublicIndex(); } } } }
  ];
  showMenuAt(rect.right-10, rect.bottom+6, items);
}

/* Example menu (three dots) */
function openExampleMenu(e,typeId,ci,ei){
  e.stopPropagation();
  const rect = e.target.getBoundingClientRect();
  const items = [
    { label:'فتح/عرض', action:()=> openExample(typeId,ci,ei) },
    { label:'إعادة تسمية', action:()=>{ const ex=getExample(typeId,ci,ei); const v=prompt('عنوان جديد:', ex.title); if(v){ ex.title=v; saveMeta(); renderPublicIndex(); openExample(typeId,ci,ei); } } },
    { label:'تحرير النص', action:()=>{ const ex=getExample(typeId,ci,ei); const v=prompt('نص النموذج:', ex.text||''); if(v!==null){ ex.text=v; saveMeta(); openExample(typeId,ci,ei); } } },
    { label:'رفع ملفات/مرفقات', action:()=>{ chooseFilesAndAttach(typeId,ci,ei); } },
    { label:'تنزيل المرفقات', action:()=> downloadExampleFiles(typeId,ci,ei) },
    { label:'طباعة', action:()=> printExample(typeId,ci,ei) },
    { label:'حذف', action:()=>{ if(confirm('حذف هذا النموذج؟')){ const t = meta.types.find(x=>x.id===typeId); t.categories[ci].examples.splice(ei,1); saveMeta(); renderPublicIndex(); document.getElementById('viewer-content').innerHTML='<div class="small">المحتوى سيظهر هنا عند اختيار عنصر.</div>'; } } }
  ];
  showMenuAt(rect.right-10, rect.bottom+6, items);
}

/* Helpers for example handling */
function getExample(typeId,ci,ei){ return meta.types.find(x=>x.id===typeId).categories[ci].examples[ei]; }

async function chooseFilesAndAttach(typeId,ci,ei){
  const inp = document.createElement('input'); inp.type='file'; inp.multiple=true;
  inp.onchange = async (ev)=>{ const files = ev.target.files; if(!files.length) return; for(let f of files){ const fid='f_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); await saveFileToDB(fid,f,FILE_STORE); const ex = getExample(typeId,ci,ei); ex.files = ex.files || []; ex.files.push({id:fid,name:f.name,type:f.type,size:f.size}); } saveMeta(); alert('تم إرفاق الملفات'); openExample(typeId,ci,ei); };
  inp.click();
}

async function downloadExampleFiles(typeId,ci,ei){
  const ex = getExample(typeId,ci,ei);
  if(!ex.files || !ex.files.length) return alert('لا ملفات مرفقة');
  for(let f of ex.files){ const blob = await getFileFromDB(f.id, FILE_STORE); if(blob){ const a=document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; a.click(); a.remove(); } }
}

function printExample(typeId,ci,ei){
  const ex = getExample(typeId,ci,ei);
  const w = window.open('','_blank'); w.document.write(`<html dir="rtl"><head><meta charset="utf-8"><title>${ex.title}</title></head><body><h2 style="text-align:right">${ex.title}</h2><pre style="white-space:pre-wrap">${ex.text||''}</pre></body></html>`); w.document.close(); w.print();
}

/* Open example in viewer */
async function openExample(typeId,ci,ei){
  const ex = getExample(typeId,ci,ei);
  const q = normalizeText(document.getElementById('search').value);
  document.getElementById('item-title').innerText = ex.title;
  const t = meta.types.find(x=>x.id===typeId);
  document.getElementById('item-meta').innerText = `${t.title} › ${t.categories[ci].title}`;
  let html = `<h4 style="text-align:right">${highlight(ex.title, q)}</h4><pre style="white-space:pre-wrap;text-align:right">${highlight(ex.text, q)}</pre>`;
  if(ex.files && ex.files.length){
    html += '<div style="margin-top:8px"><strong>الملفات المرفقة:</strong>';
    for(let f of ex.files){ html += `<div class="small">• ${f.name} <button class="icon-btn" onclick="downloadFileById('${f.id}')">تنزيل</button></div>`; }
    html += '</div>';
  }
  document.getElementById('viewer-content').innerHTML = html;
}

async function downloadFileById(id){
  const blob = await getFileFromDB(id, FILE_STORE);
  if(!blob) return alert('الملف غير موجود'); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='file'; a.click(); a.remove();
}

/* Visitor uploads handling */
document.getElementById('btn-send-visitor').addEventListener('click', async ()=>{
  const name = document.getElementById('visitor-name').value.trim();
  const message = document.getElementById('visitor-message').value.trim();
  const files = document.getElementById('visitor-files').files;
  if((!message || message.length<2) && (!files || files.length===0)) return alert('أدخل رسالة أو أرفق ملفاً.');
  const id = 'up_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  const entry = { id, name, message, files:[], created:Date.now() };
  if(files && files.length>0){ for(let f of files){ const fid='u_'+Date.now()+'_'+Math.random().toString(36).slice(2,8); await saveFileToDB(fid,f,UPLOAD_STORE); entry.files.push({id:fid,name:f.name,size:f.size,type:f.type}); } }
  const db = await openDB(); await new Promise((res,rej)=>{ const tx = db.transaction(UPLOAD_STORE,'readwrite'); tx.objectStore(UPLOAD_STORE).put(entry); tx.oncomplete=res; tx.onerror=rej; });
  alert('✅ تم الإرسال محلياً'); document.getElementById('visitor-name').value=''; document.getElementById('visitor-message').value=''; document.getElementById('visitor-files').value='';
});

// مستمع لزر عرض المرسلات للزائر
document.getElementById('btn-view-uploads').addEventListener('click', async ()=>{ await showUploadsModal(); });

/* Admin: view uploads */
document.getElementById('admin-view-uploads').addEventListener('click', async ()=>{ document.getElementById('btn-admin').click(); await showUploadsModal(); });
async function showUploadsModal(){
  const db = await openDB(); const out=[]; await new Promise((res,rej)=>{ const rq = db.transaction(UPLOAD_STORE).objectStore(UPLOAD_STORE).openCursor(); rq.onsuccess=e=>{ const cur=e.target.result; if(!cur){ res(); return; } out.push(cur.value); cur.continue(); }; rq.onerror=rej; });
  const root = document.getElementById('uploads-list'); root.innerHTML=''; if(out.length===0) root.innerHTML='<div class="small">لا توجد مرفوعات واردة</div>';
  out.forEach(entry=>{ const d=document.createElement('div'); d.style.border='1px solid #201b17'; d.style.padding='8px'; d.style.marginBottom='8px'; d.style.borderRadius='8px'; let filesHtml=''; if(entry.files){ entry.files.forEach(f=> filesHtml+=`<div class="small">📎 ${f.name} • ${Math.round((f.size||0)/1024)} KB</div>`); } d.innerHTML=`<div style="display:flex;justify-content:space-between"><div><strong>${entry.name||'زائر'}</strong><div class="small">${new Date(entry.created).toLocaleString()}</div></div><div style="display:flex;gap:6px"><button class="btn primary" onclick="downloadUploadFiles('${entry.id}')">تنزيل</button><button class="btn neutral" onclick="deleteUpload('${entry.id}')">حذف</button></div></div><div style="margin-top:8px">${entry.message||''}</div><div style="margin-top:8px">${filesHtml}</div>`; root.appendChild(d); });
  document.getElementById('uploads-modal').style.display='flex';
}
async function downloadUploadFiles(uploadId){ const db = await openDB(); const rq = db.transaction(UPLOAD_STORE).objectStore(UPLOAD_STORE).get(uploadId); rq.onsuccess=async ()=>{ const entry = rq.result; if(!entry) return alert('لم يتم العثور'); if(!entry.files||entry.files.length===0) return alert('لا توجد ملفات'); for(let f of entry.files){ const blob = await getFileFromDB(f.id, UPLOAD_STORE); if(blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=f.name; a.click(); a.remove(); URL.revokeObjectURL(a.href); } } }; rq.onerror = ()=> alert('خطأ'); }
function deleteUpload(id){ if(!confirm('حذف؟')) return; openDB().then(db=>{ const tx = db.transaction(UPLOAD_STORE,'readwrite'); tx.objectStore(UPLOAD_STORE).delete(id); tx.oncomplete = ()=>{ alert('تم الحذف'); showUploadsModal(); }; tx.onerror = ()=> alert('فشل'); }); }
document.getElementById('uploads-close').addEventListener('click', ()=> document.getElementById('uploads-modal').style.display='none');

/* Admin modal open/close + protection */
const adminModal = document.getElementById('admin-modal');
document.getElementById('btn-admin').addEventListener('click', openAdmin);
function openAdmin(){
  const pw = localStorage.getItem(ADMIN_KEY);
  if(!pw){ setAdminPassword(); return; }
  const input = prompt('الرجاء إدخال كلمة المرور لفتح الضبط:');
  if(input === pw){ adminModal.style.display='flex'; renderAdminIndex(); } else if(input!==null) alert('كلمة المرور غير صحيحة.');
}
function setAdminPassword(){ const p1 = prompt('تعيين كلمة مرور المسؤول:'); if(!p1) return; const p2 = prompt('تأكيد كلمة المرور:'); if(p1 !== p2){ alert('غير متطابقة'); return; } localStorage.setItem(ADMIN_KEY, p1); alert('✅ تم حفظ كلمة المرور'); adminModal.style.display='flex'; renderAdminIndex(); }
document.getElementById('admin-close').addEventListener('click', ()=> adminModal.style.display='none');
document.getElementById('btn-reset-password').addEventListener('click', ()=>{ if(!confirm('إعادة ضبط كلمة المرور (سيُطلب إنشاؤها من جديد)؟')) return; localStorage.removeItem(ADMIN_KEY); alert('✅ تم حذف كلمة المرور'); });
document.getElementById('btn-set-password').addEventListener('click', ()=>{ const p1 = prompt('كلمة المرور الجديدة:'); if(!p1) return; const p2 = prompt('تأكيد كلمة المرور:'); if(p1 !== p2){ alert('غير متطابقة'); return; } localStorage.setItem(ADMIN_KEY, p1); alert('✅ تم تغيير كلمة المرور'); });

// Render admin index (full control)
function renderAdminIndex(){

  const root = document.getElementById('admin-index-root'); 
  const statsRoot = document.getElementById('admin-stats');

  root.innerHTML = '';

  // حساب الإحصائيات
  let totalCats = 0;
  let totalEx = 0;
  meta.types.forEach(t => {
    totalCats += t.categories.length;
    t.categories.forEach(c => totalEx += c.examples.length);
  });

  // عرض الإحصائيات في الأعلى
  statsRoot.innerHTML = `
    <div style="text-align:center">
      <div class="small">إجمالي الأيقونات</div>
      <strong style="color:var(--accent); font-size:20px">${meta.types.length}</strong>
    </div>
    <div style="text-align:center">
      <div class="small">إجمالي الأقسام</div>
      <strong style="color:var(--accent); font-size:20px">${totalCats}</strong>
    </div>
    <div style="text-align:center">
      <div class="small">إجمالي النماذج</div>
      <strong style="color:var(--accent); font-size:20px">${totalEx}</strong>
    </div>
  `;

  // متابعة رسم القائمة الإدارية كما كانت...
  meta.types.forEach((t,ti)=>{
    const box = document.createElement('div'); 
    box.style.border='1px solid #201b17'; 
    box.style.padding='8px'; 
    box.style.marginBottom='8px'; 
    box.style.borderRadius='8px';

    let html = `<div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <strong>${t.icon} ${t.title}</strong>
        <div class="small">${t.categories.length} قسم</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn primary" onclick="adminAddCategory('${t.id}')">إضافة قسم</button>
        <button class="btn neutral" onclick="adminEditType(${ti})">تعديل</button>
        <button class="btn neutral" onclick="adminDeleteType(${ti})">حذف</button>
      </div>
    </div>`;

    html += '<div style="margin-top:8px">';
    t.categories.forEach((c,ci)=>{ 
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px;border:1px dashed #171412;margin-bottom:6px;border-radius:6px">
        <div>
          <strong>${c.title}</strong>
          <div class="small">${c.examples.length} نموذج</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn primary" onclick="adminAddExample('${t.id}',${ci})">إضافة نموذج</button>
          <button class="btn neutral" onclick="adminEditCategory('${t.id}',${ci})">تعديل</button>
          <button class="btn neutral" onclick="adminDeleteCategory('${t.id}',${ci})">حذف</button>
        </div>
      </div>`; 
    });
    html += '</div>';

    box.innerHTML = html; 
    root.appendChild(box);
  });
}

/* Admin actions */
function adminAddType(){ const id = prompt('معرف فريد للأيقونة (إنجليزي بدون مسافات):'); if(!id) return; if(meta.types.find(x=>x.id===id)) return alert('المعرف موجود'); const icon = prompt('رمز الأيقونة (إيموجي أو نص):','📁'); const title = prompt('عنوان الأيقونة:','جديد'); meta.types.push({id,icon,title,categories:[]}); saveMeta(); }
document.getElementById('admin-add-type').addEventListener('click', adminAddType);
function adminEditType(ti){ const t = meta.types[ti]; const title = prompt('اسم جديد:', t.title); if(title) t.title = title; const icon = prompt('أيقونة (إيموجي):', t.icon); if(icon) t.icon = icon; saveMeta(); }
function adminDeleteType(ti){ if(!confirm('حذف الأيقونة وكل محتواها؟')) return; meta.types.splice(ti,1); saveMeta(); }
function adminAddCategory(typeId){ const t = meta.types.find(x=>x.id===typeId); const name = prompt('اسم القسم:'); if(name){ t.categories.push({title:name,examples:[]}); saveMeta(); renderAdminIndex(); } }
function adminEditCategory(typeId,ci){ const t = meta.types.find(x=>x.id===typeId); const c = t.categories[ci]; const name = prompt('تعديل اسم القسم:', c.title); if(name){ c.title = name; saveMeta(); renderAdminIndex(); } }
function adminDeleteCategory(typeId,ci){ const t = meta.types.find(x=>x.id===typeId); if(!confirm('حذف القسم وكل نماذجه؟')) return; t.categories.splice(ci,1); saveMeta(); renderAdminIndex(); }
function adminAddExample(typeId,ci){ const title = prompt('عنوان النموذج:'); if(!title) return; const text = prompt('نص النموذج:')||''; const t = meta.types.find(x=>x.id===typeId); t.categories[ci].examples.push({title,text,files:[]}); saveMeta(); renderAdminIndex(); }

/* export/import JSON */
document.getElementById('export-json').addEventListener('click', ()=>{ const blob = new Blob([JSON.stringify(meta,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='maktabat_meta_'+Date.now()+'.json'; a.click(); a.remove(); });
document.getElementById('admin-import-json').addEventListener('click', ()=>{ const inp = document.createElement('input'); inp.type='file'; inp.accept='application/json'; inp.onchange = (e)=>{ const f = e.target.files[0]; const r = new FileReader(); r.onload = ()=>{ try{ const data = JSON.parse(r.result); if(data.types){ meta = data; saveMeta(); alert('تم الاستيراد'); } else alert('ملف غير صالح'); }catch(err){ alert('خطأ بالاستيراد'); } }; r.readAsText(f); }; inp.click(); });
// مستمع لزر استيراد JSON للزائر
document.getElementById('import-json').addEventListener('click', ()=>{ const inp = document.createElement('input'); inp.type='file'; inp.accept='application/json'; inp.onchange = (e)=>{ const f = e.target.files[0]; const r = new FileReader(); r.onload = ()=>{ try{ const data = JSON.parse(r.result); if(data.types){ meta = data; saveMeta(); alert('تم الاستيراد'); } else alert('ملف غير صالح'); }catch(err){ alert('خطأ بالاستيراد'); } }; r.readAsText(f); }; inp.click(); });

/* export uploaded files */
document.getElementById('admin-export-files').addEventListener('click', async ()=>{
  const files = await listAllFilesMeta(UPLOAD_STORE);
  if(files.length===0) return alert('لا توجد ملفات محفوظة');
  alert('سيتم تنزيل الملفات واحداً تلو الآخر.');
  for(let f of files){ const blob = await getFileFromDB(f.id, UPLOAD_STORE); if(blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download = f.name; a.click(); a.remove(); } }
});

/* clear uploads */
document.getElementById('admin-clear-uploads').addEventListener('click', async ()=>{ if(!confirm('حذف كل المرسلات؟')) return; const db = await openDB(); await new Promise((res,rej)=>{ const tx = db.transaction(UPLOAD_STORE,'readwrite'); tx.objectStore(UPLOAD_STORE).clear(); tx.oncomplete=res; tx.onerror=rej; }); alert('✅ تم حذف المرسلات'); });

/* PWA install prompt */
let deferredPrompt = null;
const installBtn = document.getElementById('btn-install');
window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredPrompt=e; installBtn.style.display='inline-block'; });
installBtn.addEventListener('click', async ()=>{ if(!deferredPrompt){ alert('خيار التثبيت غير متاح الآن — استخدم خادم محلي/HTTPS'); return; } deferredPrompt.prompt(); const choice = await deferredPrompt.userChoice; if(choice.outcome==='accepted') alert('تم تثبيت التطبيق'); deferredPrompt=null; installBtn.style.display='none'; });

/* viewer actions (download/print/share) */
document.getElementById('btn-download-selected').addEventListener('click', ()=>{ const title = document.getElementById('item-title').innerText; const content = document.getElementById('viewer-content').innerText; if(!title || title.includes('اختر')) return alert('اختر عنصرًا أولاً'); const blob = new Blob([content],{type:'text/plain'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download = title.replace(/\s+/g,'_')+'.txt'; a.click(); a.remove(); });
document.getElementById('btn-print-selected').addEventListener('click', ()=>{ if(!document.getElementById('item-title').innerText) return; const w = window.open('','_blank'); w.document.write(document.getElementById('viewer-content').innerHTML); w.document.close(); w.print(); });
document.getElementById('btn-share-selected').addEventListener('click', async ()=>{ if(navigator.share){ await navigator.share({ title: document.getElementById('item-title').innerText, text: document.getElementById('viewer-content').innerText }); } else alert('المشاركة غير مدعومة'); });
btnCopySelected.addEventListener('click', ()=>{ 
  const content = document.getElementById('viewer-content').innerText;
  if(!content || content.includes('المحتوى سيظهر هنا')) return alert('اختر عنصرًا أولاً');
  navigator.clipboard.writeText(content).then(()=>{
    const old = btnCopySelected.innerHTML;
    btnCopySelected.innerHTML = '<span>✅ تم النسخ</span>';
    setTimeout(()=> btnCopySelected.innerHTML = old, 1500);
  }).catch(()=> alert('عذراً، تعذر النسخ'));
});

/* Search button */
document.getElementById('search-btn').addEventListener('click', ()=>{ renderPublicIndex(); });
document.getElementById('search').addEventListener('input', ()=>{ /* live filter */ renderPublicIndex(); });

/* init */
ensureDefaults();
renderTopStrip();
openType(meta.types[0].id);
renderPublicIndex();

/* click outside to hide menu */
document.addEventListener('click',(e)=>{ if(!e.target.closest('.menu') && !e.target.closest('.dots')) hideMenu(); });

// إغلاق مودالات الإضافة الجديدة عند النقر في الخارج
window.addEventListener('click', (e) => {
    if (e.target.id === 'editor-modal') e.target.style.display = 'none';
    if (e.target.id === 'trash-modal-advanced') e.target.style.display = 'none';
});

/* ===========================================================
   تفعيل أدوات الإدارة الأصيلة (المحرر، السلة المتقدمة، المزامنة)
   =========================================================== */

// 1. منطق المحرر (البسملة فقط في المنتصف)
document.getElementById('btn-open-editor').onclick = () => {
    const editor = document.getElementById('legal-editor');
    document.getElementById('editor-modal').style.display = 'block';
    
    if (editor.innerText.trim().length < 5) {
        editor.innerHTML = `<div style="text-align:center; margin-bottom:30px;"><h3>بسم الله الرحمن الرحيم</h3></div><br>`;
    }
};

// 2. دالة الحفظ (تم إصلاح الربط مع IndexedDB)
async function saveEditorContent() {
    try {
        const content = document.getElementById('legal-editor').innerHTML;
        const clientName = prompt('يرجى إدخال اسم صاحب القضية:');
        if (!clientName) return;

        let typeOptions = meta.types.map((t, i) => `${i + 1}- ${t.title}`).join('\n');
        let typeChoice = prompt("اختر رقم الأيقونة المراد الحفظ فيها:\n" + typeOptions, "1");
        let selectedType = meta.types[parseInt(typeChoice) - 1] || meta.types[0];

        if (!selectedType.categories.length) {
            alert('هذه الأيقونة لا تحتوي على أقسام. يرجى إنشاء قسم أولاً من لوحة الإدارة.');
            return;
        }

        let catIndex = 0;
        if (selectedType.categories.length > 1) {
            let catOptions = selectedType.categories.map((c, i) => `${i + 1}- ${c.title}`).join('\n');
            let catChoice = prompt("اختر رقم القسم:\n" + catOptions, "1");
            catIndex = parseInt(catChoice) - 1 || 0;
        }

        const blob = new Blob([content], {type: 'text/html'});
        const fileId = 'legal_' + Date.now();
        const fileObj = new File([blob], clientName.replace(/\s+/g, '_') + '.html', {type: 'text/html'});

        await saveFileToDB(fileId, fileObj, FILE_STORE);

        selectedType.categories[catIndex].examples.push({
            title: '⚖️ ' + clientName,
            text: content,
            files: [{id: fileId, name: fileObj.name, type: fileObj.type, size: blob.size}]
        });

        saveMeta();
        renderPublicIndex();
        renderAdminIndex();

        alert(`✅ تم الحفظ بنجاح: ${clientName}`);
        document.getElementById('editor-modal').style.display = 'none';
        document.getElementById('legal-editor').innerHTML = '';
    } catch (error) {
        console.error("فشل الحفظ:", error);
        alert("تنبيه: تعذر الحفظ. تأكد من أن المتصفح يدعم IndexedDB.");
    }
}

// 3. تفعيل سلة المحذوفات (إظهار الملفات وتفعيل التحديد)
document.getElementById('btn-show-trash-advanced').onclick = () => {
    renderAdvancedTrash();
    document.getElementById('trash-modal-advanced').style.display = 'block';
};

function renderAdvancedTrash() {
    const listRoot = document.getElementById('trash-list-advanced');
    const bulkBar = document.getElementById('trash-bulk-actions');
    listRoot.innerHTML = '';
    
    if (!window.trash || window.trash.length === 0) {
        listRoot.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">السلة فارغة حالياً</div>';
        bulkBar.style.display = 'none';
        return;
    }

    bulkBar.style.display = 'flex';
    window.trash.forEach((item, index) => {
        const row = document.createElement('div');
        row.style = 'display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--line); background: rgba(255,255,255,0.02); margin-bottom:5px; border-radius:5px;';
        row.innerHTML = `
            <input type="checkbox" class="trash-sel-v7" data-idx="${index}" style="width:18px; height:18px; cursor:pointer;">
            <div style="flex-grow:1">
                <div style="color:var(--accent); font-weight:bold;">${item.title}</div>
                <div style="font-size:10px; opacity:0.6">المصدر: ${item.typeId}</div>
            </div>
        `;
        listRoot.appendChild(row);
    });
}

// تنفيذ الاستعادة أو الحذف النهائي الجماعي
async function bulkTrashAction(action) {
    const selected = document.querySelectorAll('.trash-sel-v7:checked');
    if (selected.length === 0) return alert('يرجى تحديد ملفات من القائمة');

    if (action === 'delete' && !confirm('هل أنت متأكد من الحذف النهائي؟')) return;

    const indices = Array.from(selected).map(el => parseInt(el.dataset.idx)).sort((a, b) => b - a);

    for (let idx of indices) {
        const item = window.trash[idx];
        if (action === 'restore') {
            const targetType = meta.types.find(t => t.id === item.typeId);
            if (targetType && targetType.categories.length > 0) {
                targetType.categories[0].examples.push({
                    title: item.title,
                    text: item.textContent || '',
                    files: item.fileData ? [{id: item.id, name: item.fileName || 'file', type: item.fileType || '', size: item.fileSize || 0}] : []
                });
            }
        }
        window.trash.splice(idx, 1);
    }

    saveMeta();
    saveTrash();
    renderAdvancedTrash();
    renderAdminIndex();
    renderPublicIndex();
    alert(action === 'restore' ? '✅ تمت استعادة الملفات بنجاح' : '🗑️ تم الحذف النهائي');
}

// 4. المزامنة (الكود الناجح الذي يحفظ النسخة الاحتياطية)
document.getElementById('btn-cloud-sync').onclick = function() {
    const btn = this;
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-sync fa-spin"></i> جاري المزامنة...';
    
    setTimeout(() => {
        // الاحتفاظ بالمنطق الناجح الذي يحفظ في localStorage
        const backupData = {
            meta: meta,
            trash: window.trash,
            timestamp: new Date().toISOString()
        };
        localStorage.setItem('alaysaei_sync_v7', JSON.stringify(backupData));
        
        btn.innerHTML = '<i class="fas fa-check"></i> متزامن محلياً';
        btn.style.background = '#28a745';
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '#2d5a88';
            alert('تم تأمين نسخة احتياطية كاملة بنجاح.');
        }, 2000);
    }, 1500);
};

// أوامر تنسيق المحرر
function execCmd(cmd) { document.execCommand(cmd, false, null); }
