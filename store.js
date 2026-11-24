// Хранилище: локально в телефоне (работает без сети) + синхронизация через Supabase,
// чтобы у обоих был один журнал, одни настройки и общая история изменений.
// Вход по почте и паролю (Supabase Auth). Имя пользователя подписывает все изменения.

import { DEFAULT_PARAMS, normalizeParams } from './calc.js?v=19';
import { SUPABASE } from './config.js?v=19';

const LS_DAYS = 'days-v1';
const LS_PARAMS = 'params-v1';
const LS_SYNC = 'sync-v2';
const LS_ME = 'me-v1';
const LS_LOG = 'log-v1';

const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const now = () => new Date().toISOString();
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const t = s => Date.parse(s) || 0;

// ---------- кто я ----------
export const me = () => localStorage.getItem(LS_ME) || '';
export const setMe = name => localStorage.setItem(LS_ME, name.trim());

// ---------- история изменений ----------
// entry = { id, at, by, text, key, dirty }
let log = load(LS_LOG, []);
const persistLog = () => put(LS_LOG, log.slice(0, 500));
export const getLog = () => log.slice().sort((a, b) => t(b.at) - t(a.at));
/**
 * Записать изменение. key — чтобы подряд идущие правки одного поля одним человеком
 * в течение 2 минут склеивались в одну запись (не по записи на каждую нажатую цифру).
 */
export function addLog(text, key = '') {
  const last = getLog()[0];
  if (key && last && last.key === key && last.by === me() && Date.now() - t(last.at) < 120_000) {
    Object.assign(last, { text, at: now(), dirty: true });
  } else {
    log.unshift({ id: uid(), at: now(), by: me(), text, key, dirty: true });
  }
  persistLog();
  scheduleSync();
}

/** Убрать свою последнюю запись по key (правку вернули к исходному значению). */
export function dropLog(key) {
  const last = getLog()[0];
  if (!last || last.key !== key || last.by !== me()) return;
  if (!last.dirty) { last.text = last.text + ' (отменено)'; last.dirty = true; }
  else log = log.filter(e => e !== last);
  persistLog();
  scheduleSync();
}

// ---------- дни ----------
// day = { date, ops: [{id, amount, ooo, at, by}], deletedOps: [id], cb, cbDate, cbManual, updatedAt, updatedBy, deleted, dirty }
let days = load(LS_DAYS, {});
const persistDays = () => put(LS_DAYS, days);

export const getDay = date => {
  const d = days[date];
  if (!d || d.deleted) return null;
  // старый формат: одна сумма за день → одно поступление
  if (!d.ops) return { ...d, ops: d.flow ? [{ id: 'legacy', amount: d.flow, at: d.updatedAt }] : [] };
  return d;
};
export const listDays = () => Object.keys(days).map(getDay).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));

export function saveDay(day) {
  const prev = days[day.date];
  // удалённые поступления запоминаем, чтобы при слиянии с телефоном партнёра они не вернулись
  const deletedOps = [...new Set([...(prev?.deletedOps || []), ...(day.deletedOps || []),
    ...(prev?.ops || []).filter(o => !day.ops.some(x => x.id === o.id)).map(o => o.id)])];
  days[day.date] = { ...day, deletedOps, deleted: false, updatedAt: now(), updatedBy: me(), dirty: true };
  persistDays();
  scheduleSync();
}
export function deleteDay(date) {
  const prev = days[date];
  if (!prev) return;
  days[date] = { ...prev, deletedOps: [...new Set([...(prev.deletedOps || []), ...(prev.ops || []).map(o => o.id)])], ops: [],
    deleted: true, updatedAt: now(), updatedBy: me(), dirty: true };
  persistDays();
  scheduleSync();
}

/** Слияние дня, если оба меняли его одновременно: объединяем поступления, удалённые не возвращаем. */
export function mergeDay(a, b) {
  const gone = new Set([...(a.deletedOps || []), ...(b.deletedOps || [])]);
  const ops = [...(a.ops || []), ...(b.ops || []).filter(o => !(a.ops || []).some(x => x.id === o.id))].filter(o => !gone.has(o.id));
  const newer = t(a.updatedAt) >= t(b.updatedAt) ? a : b;
  return { ...newer, ops, deletedOps: [...gone], deleted: ops.length === 0 && (a.deleted || b.deleted),
    flow: ops.reduce((s, o) => s + o.amount, 0), updatedAt: now() };
}

// ---------- параметры ----------
let paramsMeta = load(LS_PARAMS, { updatedAt: '1970-01-01T00:00:00Z' });
let params = normalizeParams(paramsMeta.data);
export const getParams = () => structuredClone(params);
export function setParams(p) {
  params = normalizeParams(p);
  paramsMeta = { data: params, updatedAt: now(), updatedBy: me(), dirty: true };
  put(LS_PARAMS, paramsMeta);
  scheduleSync();
}
export function resetParams() { setParams(structuredClone(DEFAULT_PARAMS)); }

// ---------- синхронизация (Supabase REST + вход по паролю) ----------
export const syncCfg = () => {
  const c = load(LS_SYNC, {});
  return { ...c, url: (SUPABASE.url || c.url || '').replace(/\/+$/, ''), anonKey: SUPABASE.anonKey || c.anonKey || '' };
};
export const baseConfigured = () => { const c = syncCfg(); return !!(c.url && c.anonKey); };
export const loggedIn = () => !!syncCfg().refresh;
const setSession = c => put(LS_SYNC, c);

export async function login(email, password, url, anonKey) {
  const base = syncCfg();
  url = (url || base.url).replace(/\/+$/, ''); anonKey = anonKey || base.anonKey;
  if (!url || !anonKey) throw new Error('Общая база ещё не подключена');
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description === 'Invalid login credentials' ? 'Неверная почта или пароль' : (j.error_description || j.msg || 'Не удалось войти'));
  setSession({ url, anonKey, email, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
  if (!me()) setMe(j.user?.user_metadata?.name || email.split('@')[0]);
  await syncNow();
}
export function logout() { const c = syncCfg(); setSession({ url: c.url, anonKey: c.anonKey }); emit({ state: 'off' }); }

async function token() {
  const c = syncCfg();
  if (!c.refresh) return null;
  if (Date.now() < c.exp - 60_000) return c.access;
  const r = await fetch(`${c.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: c.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { setSession({ url: c.url, anonKey: c.anonKey, email: c.email }); throw new Error('Сессия истекла — войдите снова'); }
  setSession({ ...c, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

let listeners = [];
export const onChange = fn => listeners.push(fn);
const emit = status => listeners.forEach(fn => fn(status));

async function api(path, opts = {}) {
  const c = syncCfg();
  const tk = await token();
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: c.anonKey, Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Синхронизация: ${r.status} ${await r.text()}`);
  return r.status === 204 || r.status === 201 ? null : r.json();
}
const upsert = (table, rows) => api(table, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });

let timer = null, running = false, again = false;
function scheduleSync() { clearTimeout(timer); timer = setTimeout(syncNow, 800); }
const strip = ({ dirty, ...rest }) => rest;

export async function syncNow() {
  if (!loggedIn()) { emit({ state: 'off' }); return; }
  if (!navigator.onLine) { emit({ state: 'offline' }); return; }
  if (running) { again = true; return; }
  running = true;
  emit({ state: 'syncing' });
  try {
    // 1) забираем всё с сервера и сливаем со своим
    const remoteDays = await api('days?select=date,data,deleted,updated_at');
    for (const r of remoteDays) {
      const remote = { ...r.data, date: r.date, deleted: r.deleted, updatedAt: r.updated_at };
      const local = days[r.date];
      if (!local) days[r.date] = { ...remote, dirty: false };
      else if (local.dirty) days[r.date] = { ...mergeDay(local, remote), dirty: true };
      else if (t(local.updatedAt) !== t(r.updated_at)) days[r.date] = { ...remote, dirty: false };
    }
    const remoteSettings = await api('settings?id=eq.1&select=data,updated_at');
    if (remoteSettings[0] && !paramsMeta.dirty && t(remoteSettings[0].updated_at) > t(paramsMeta.updatedAt)) {
      params = normalizeParams(remoteSettings[0].data);
      paramsMeta = { data: params, updatedAt: remoteSettings[0].updated_at, dirty: false };
      put(LS_PARAMS, paramsMeta);
    }
    const remoteLog = (await api('log?select=id,at,who,text&order=at.desc&limit=500')).map(({ who, ...e }) => ({ ...e, by: who }));
    for (const e of remoteLog) {
      const i = log.findIndex(x => x.id === e.id);
      if (i < 0) log.push({ ...e, dirty: false });
      else if (!log[i].dirty) log[i] = { ...log[i], ...e };
    }

    // 2) отправляем свои изменения
    const dirtyDays = Object.values(days).filter(d => d.dirty);
    if (dirtyDays.length) {
      await upsert('days', dirtyDays.map(d => ({ date: d.date, data: strip(d), deleted: !!d.deleted, updated_at: d.updatedAt, updated_by: d.updatedBy || me() })));
      dirtyDays.forEach(d => { days[d.date].dirty = false; });
    }
    if (paramsMeta.dirty) {
      await upsert('settings', [{ id: 1, data: params, updated_at: paramsMeta.updatedAt }]);
      paramsMeta.dirty = false; put(LS_PARAMS, paramsMeta);
    }
    const dirtyLog = log.filter(e => e.dirty);
    if (dirtyLog.length) {
      await upsert('log', dirtyLog.map(e => ({ id: e.id, at: e.at, who: e.by, text: e.text })));
      dirtyLog.forEach(e => { e.dirty = false; });
    }
    persistDays(); persistLog();
    emit({ state: 'ok', at: new Date() });
  } catch (e) {
    emit({ state: 'error', message: e.message });
  } finally {
    running = false;
    if (again) { again = false; scheduleSync(); }
  }
}

window.addEventListener('online', syncNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
// подтягиваем изменения партнёра, пока приложение открыто
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30_000);
