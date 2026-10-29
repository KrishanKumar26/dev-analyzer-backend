export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function cleanHandle(raw) {
  if (raw == null) return null;
  let h = String(raw).trim().replace(/\s+/g, '');
  while (h.startsWith('@')) h = h.slice(1);
  return h;
}

const UA = 'Mozilla/5.0';

export async function httpGet(url, { bearer, headers = {}, timeout = 8000 } = {}) {
  const h = { 'User-Agent': UA, Accept: 'application/json', ...headers };
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  const r = await fetch(url, { headers: h, signal: AbortSignal.timeout(timeout) });
  return { status: r.status, text: await r.text() };
}

export async function httpPost(url, body, { bearer, headers = {}, timeout = 8000 } = {}) {
  const h = { 'Content-Type': 'application/json', 'User-Agent': UA, ...headers };
  if (bearer) h.Authorization = `Bearer ${bearer}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: h,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  return { status: r.status, text: await r.text() };
}

export const getJson = async (url, opts) => JSON.parse((await httpGet(url, opts)).text);
