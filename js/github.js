/* مزامنة حقيقية مع GitHub عبر REST API (commit واحد ذرّي لعدة ملفات) */
import { b64enc } from './crypto.js';

const API = 'https://api.github.com';

function explain(status, msg) {
  if (status === 401) return 'الرمز (Token) غير صالح أو منتهي.';
  if (status === 403) return 'ليس لدى الرمز صلاحية كافية (يلزم Contents: Read and write) أو تم تجاوز حد الطلبات.';
  if (status === 404) return 'المستودع أو الفرع غير موجود، أو الرمز لا يملك الوصول إليه.';
  if (status === 409) return 'تعارض: تغيّر المستودع أثناء العملية. أعد المحاولة.';
  if (status === 422) return 'GitHub رفض البيانات: ' + (msg || '');
  return `خطأ من GitHub (${status}) ${msg || ''}`;
}

async function call(cfg, path, { method = 'GET', body, raw = false } = {}) {
  let res;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch {
    throw new Error('تعذّر الاتصال بـ GitHub. تأكد من الإنترنت.');
  }
  if (!res.ok) {
    let m = '';
    try { m = (await res.json()).message; } catch { /* ignore */ }
    const e = new Error(explain(res.status, m));
    e.status = res.status;
    throw e;
  }
  if (raw) return res;
  return res.status === 204 ? null : res.json();
}

const repoPath = (cfg) => `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;

export async function testConnection(cfg) {
  const r = await call(cfg, repoPath(cfg));
  if (!r.permissions?.push) throw new Error('الرمز يقرأ المستودع فقط؛ يلزم صلاحية الكتابة (Contents: Read and write).');
  return { branch: cfg.branch || r.default_branch, private: r.private, full: r.full_name };
}

async function branchOf(cfg) {
  if (cfg.branch) return cfg.branch;
  return (await call(cfg, repoPath(cfg))).default_branch;
}

/* files: { 'path/a.json': string | Uint8Array | null(حذف) } */
export async function commitFiles(cfg, files, message, onProgress = () => {}) {
  const base = repoPath(cfg);
  const branch = await branchOf(cfg);
  const ref = await call(cfg, `${base}/git/ref/heads/${encodeURIComponent(branch)}`);
  const headSha = ref.object.sha;
  const head = await call(cfg, `${base}/git/commits/${headSha}`);

  const entries = [];
  const todo = Object.entries(files);
  let done = 0;
  let idx = 0;
  async function worker() {
    while (idx < todo.length) {
      const [path, content] = todo[idx++];
      if (content === null) {
        entries.push({ path, mode: '100644', type: 'blob', sha: null });
      } else {
        const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
        const b = await call(cfg, `${base}/git/blobs`, { method: 'POST', body: { content: b64enc(bytes), encoding: 'base64' } });
        entries.push({ path, mode: '100644', type: 'blob', sha: b.sha });
      }
      onProgress(++done, todo.length);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker));
  if (!entries.length) return { changed: false };

  const tree = await call(cfg, `${base}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree: entries } });
  if (tree.sha === head.tree.sha) return { changed: false };
  const commit = await call(cfg, `${base}/git/commits`, { method: 'POST', body: { message, tree: tree.sha, parents: [headSha] } });
  await call(cfg, `${base}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } });
  return { changed: true, sha: commit.sha, branch };
}

/* أسماء الملفات الموجودة تحت مجلد معيّن في المستودع (لحذف المتقادم) */
export async function listPaths(cfg, prefix) {
  const branch = await branchOf(cfg);
  const t = await call(cfg, `${repoPath(cfg)}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  return t.tree.filter((e) => e.type === 'blob' && e.path.startsWith(prefix)).map((e) => e.path);
}

export async function readText(cfg, path) {
  const branch = await branchOf(cfg);
  try {
    const res = await call(cfg, `${repoPath(cfg)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(branch)}`, { raw: true });
    return await res.text();
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}
