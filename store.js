// Хранилище: локально в телефоне (работает без сети) + синхронизация через Supabase,
// чтобы у обоих был один журнал. Конфликты — побеждает более поздняя правка.

import { DEFAULT_PARAMS, normalizeParams } from './calc.js';

const LS_DAYS = 'days-v1';
const LS_PARAMS = 'params-v1';
const LS_SYNC = 'sync-v1';

const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ---------- дни ----------
// day = { date, flow, cb, cbDate, cbManual, params, updatedAt, updatedBy, deleted, dirty }
let days = load(LS_DAYS, {});
const persistDays = () => put(LS_DAYS, days);

export const listDays = () => Object.values(days).filter(d => !d.deleted).sort((a, b) => b.date.localeCompare(a.date));
export const getDay = date => {
  const d = days[date];
  if (!d || d.deleted) return null;
  // старый формат: одна сумма за день → одно поступление
  if (!d.ops) return { ...d, ops: d.flow ? [{ id: 'legacy', amount: d.flow, at: d.updatedAt }] : [] };
  return d;
};

export function saveDay(day) {
  days[day.date] = { ...day, deleted: false, updatedAt: new Date().toISOString(), updatedBy: syncCfg().email || '', dirty: true };
  persistDays();
  scheduleSync();
}
export function deleteDay(date) {
  if (!days[date]) return;
  days[date] = { ...days[date], deleted: true, updatedAt: new Date().toISOString(), dirty: true };
  persistDays();
  scheduleSync();
}

// ---------- параметры ----------
let params = normalizeParams(load(LS_PARAMS, {}).data);
let paramsMeta = load(LS_PARAMS, { updatedAt: '1970-01-01T00:00:00Z' });
export const getParams = () => structuredClone(params);
export function setParams(p) {
  params = structuredClone(p);
  paramsMeta = { data: params, updatedAt: new Date().toISOString(), dirty: true };
  put(LS_PARAMS, paramsMeta);
  scheduleSync();
}
export function resetParams() { setParams(structuredClone(DEFAULT_PARAMS)); }

// ---------- синхронизация (Supabase REST) ----------
export const syncCfg = () => load(LS_SYNC, {});
const setSyncCfg = c => put(LS_SYNC, c);

let listeners = [];
export const onChange = fn => listeners.push(fn);
const emit = status => listeners.forEach(fn => fn(status));

export async function login(url, anonKey, email, password) {
  url = url.replace(/\/+$/, '');
  const r = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.msg || 'Не удалось войти');
  setSyncCfg({ url, anonKey, email, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
  await syncNow();
}
export function logout() { setSyncCfg({}); emit({ state: 'off' }); }

async function token() {
  const c = syncCfg();
  if (!c.refresh) return null;
  if (Date.now() < c.exp - 60_000) return c.access;
  const r = await fetch(`${c.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: c.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh }),
  });
  const j = await r.json();
  if (!r.ok) { setSyncCfg({ ...c, access: null, refresh: null }); throw new Error('Сессия истекла — войдите снова'); }
  setSyncCfg({ ...c, access: j.access_token, refresh: j.refresh_token, exp: Date.now() + j.expires_in * 1000 });
  return j.access_token;
}

async function api(path, opts = {}) {
  const c = syncCfg();
  const t = await token();
  const r = await fetch(`${c.url}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: c.anonKey, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Синхронизация: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

let timer = null, running = false;
function scheduleSync() { clearTimeout(timer); timer = setTimeout(syncNow, 800); }

const strip = ({ dirty, ...rest }) => rest;
const t = s => Date.parse(s) || 0;

export async function syncNow() {
  const c = syncCfg();
  if (!c.refresh) { emit({ state: 'off' }); return; }
  if (!navigator.onLine) { emit({ state: 'offline' }); return; }
  if (running) return; running = true;
  emit({ state: 'syncing' });
  try {
    // 1) забираем всё с сервера
    const remoteDays = await api('days?select=date,data,deleted,updated_at');
    for (const r of remoteDays) {
      const local = days[r.date];
      if (!local || (!local.dirty && t(local.updatedAt) !== t(r.updated_at)) || (local.dirty && t(r.updated_at) > t(local.updatedAt))) {
        days[r.date] = { ...r.data, date: r.date, deleted: r.deleted, updatedAt: r.updated_at, dirty: false };
      }
    }
    const remoteSettings = await api('settings?id=eq.1&select=data,updated_at');
    if (remoteSettings[0] && !paramsMeta.dirty && t(remoteSettings[0].updated_at) > t(paramsMeta.updatedAt)) {
      params = normalizeParams(remoteSettings[0].data);
      paramsMeta = { data: params, updatedAt: remoteSettings[0].updated_at, dirty: false };
      put(LS_PARAMS, paramsMeta);
    }
    // 2) отправляем свои изменения
    const dirty = Object.values(days).filter(d => d.dirty);
    if (dirty.length) {
      await api('days', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(dirty.map(d => ({ date: d.date, data: strip(d), deleted: !!d.deleted, updated_at: d.updatedAt, updated_by: c.email }))),
      });
      dirty.forEach(d => { days[d.date].dirty = false; });
    }
    if (paramsMeta.dirty) {
      await api('settings', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify([{ id: 1, data: params, updated_at: paramsMeta.updatedAt }]),
      });
      paramsMeta.dirty = false; put(LS_PARAMS, paramsMeta);
    }
    persistDays();
    emit({ state: 'ok', at: new Date() });
  } catch (e) {
    emit({ state: 'error', message: e.message });
  } finally { running = false; }
}

window.addEventListener('online', syncNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
