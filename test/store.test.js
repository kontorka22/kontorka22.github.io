import { test } from 'node:test';
import assert from 'node:assert/strict';

// заглушки браузера для store.js
const mem = {};
globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {}, visibilityState: 'hidden' };
globalThis.navigator = { onLine: false };
globalThis.setInterval = () => 0;

const store = await import('../store.js');

test('одновременные поступления двоих в один день не теряются, удалённые не возвращаются', () => {
  const mine = { date: '2026-11-24', ops: [{ id: 'a', amount: 1 }, { id: 'c', amount: 3 }], deletedOps: ['b'], updatedAt: '2026-11-24T10:00:00Z' };
  const his = { date: '2026-11-24', ops: [{ id: 'a', amount: 1 }, { id: 'b', amount: 2 }, { id: 'd', amount: 4 }], deletedOps: [], updatedAt: '2026-11-24T10:01:00Z' };
  const m = store.mergeDay(mine, his);
  assert.deepEqual(m.ops.map(o => o.id).sort(), ['a', 'c', 'd']);
  assert.equal(m.flow, 8);
});

test('история: правки одного поля склеиваются, подпись — имя', () => {
  store.setMe('Макс');
  store.addLog('Себес · Гонконг · Комиссия: 2% → 2,1%', 'k');
  store.addLog('Себес · Гонконг · Комиссия: 2% → 2,5%', 'k');
  const log = store.getLog();
  assert.equal(log.length, 1);
  assert.equal(log[0].by, 'Макс');
  assert.match(log[0].text, /2,5%/);
  store.dropLog('k');
  assert.equal(store.getLog().length, 0);
});

test('удаление поступления запоминается', () => {
  store.saveDay({ date: '2026-11-25', ops: [{ id: 'x', amount: 5 }, { id: 'y', amount: 6 }], cb: 80 });
  store.saveDay({ ...store.getDay('2026-11-25'), ops: [{ id: 'x', amount: 5 }] });
  assert.deepEqual(store.getDay('2026-11-25').deletedOps, ['y']);
  assert.equal(store.getDay('2026-11-25').updatedBy, 'Макс');
});
