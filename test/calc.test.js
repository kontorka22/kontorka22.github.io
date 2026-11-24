import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcDay, DEFAULT_PARAMS, periodReport, clientQuote, rubForUsdt, lumpsIn, monthsOfYear } from '../calc.js';

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const m = (name, amount, period = 'month', from) => ({ id: name, name, amount, period, from });

// параметры как в таблице: одно ООО с ФОТ 350 000, Дубай 5 000 + 5 000
function sheetParams(cb) {
  const p = structuredClone(DEFAULT_PARAMS);
  p.cost = { markupRub: 1, hkPct: 0.0175 }; // как в таблице: B2+1
  p.ooo[0].expenses = [m('ФОТ', 350000)];
  p.dubai = [m('Номинал', 5000), m('Бух', 5000)];
  return p;
}

test('совпадает с листом «Модель Рост», колонка E', () => {
  const cb = 81.7947;
  const r = calcDay([{ amount: 60_000_000, ooo: 1 }], cb, sheetParams(cb), 1);
  const u = r.units.find(x => x.id === 1);
  near(u.rf.agentRub, 900000);
  near(u.rf.vatRub, 162295.082, 1e-3);
  near(u.rf.taxRub, 21926.22951);
  near(u.rf.resultRub, 65778.68852);     // E28 «Сверка»
  near(u.cost.hkRub, 1034250);           // E31
  near(u.cost.usdt, 701322.0653, 1e-3);  // E33
  near(r.costUsdt, 691322.0653, 1e-3);   // E38
  near(r.costRate, 86.79022848, 1e-6);   // E39
});

test('расходы Дубая делятся на включённые ООО', () => {
  const p = sheetParams(80);
  p.ooo[1].active = true; p.ooo[2].active = true;
  const r = calcDay([{ amount: 3e7, ooo: 1 }, { amount: 3e7, ooo: 2 }], 80, p, 1);
  for (const id of [1, 2, 3]) near(r.units.find(u => u.id === id).dubaiUsd, 10000 / 3);
  near(r.dubaiUsd, 10000);
  near(r.convUsdt - r.costUsdt, 10000);
});

test('без ООО — поток напрямую в Гонконг, Дубай целиком', () => {
  const p = sheetParams(80);
  p.ooo[0].active = false;
  const r = calcDay([{ amount: 1e6 }], 80, p, 1);
  assert.equal(r.units.length, 1);
  assert.equal(r.units[0].id, 0);
  near(r.units[0].transitRub, 1e6);
  near(r.units[0].dubaiUsd, 10000);
  near(clientQuote(1e6, 80, p, 0), r.saleUsdt);
});

test('годовые и разовые статьи', () => {
  const items = [m('Лицензия', 12000, 'year', '2026-11'), m('Счета', 36018, 'once', '2026-11')];
  assert.equal(lumpsIn(items, '2026-11').length, 2);
  assert.deepEqual(lumpsIn(items, '2027-11').map(e => e.name), ['Лицензия']);
  assert.equal(lumpsIn(items, '2027-01').length, 0);
});

test('отчёт за месяц: Дубай за полный месяц, налог по ООО помесячно', () => {
  const p = sheetParams(82);
  const days = [{ date: '2026-12-01', ops: [{ amount: 6e7, ooo: 1 }], cb: 82, params: p }];
  const r = periodReport(days, p, { kind: 'month', months: ['2026-12'] });
  near(r.convUsdt - r.costUsdt, 10000);
  near(r.ooo[0].fixedRub, 350000);
  const d = calcDay(days[0].ops, 82, p, 1);
  near(r.ooo[0].resultRub, d.units[0].rf.resultRub);
});

test('отчёт за день совпадает с расчётом дня', () => {
  const p = sheetParams(82);
  const days = [{ date: '2026-12-05', ops: [{ amount: 6e7, ooo: 1 }], cb: 82, params: p }];
  const r = periodReport(days, p, { kind: 'day', date: '2026-12-05' });
  const d = calcDay(days[0].ops, 82, p, 1 / 31);
  near(r.diffUsdt, d.diffUsdt, 1e-6);
  near(r.oooResultRub, d.oooResultRub, 1e-6);
});

test('год — только наступившие месяцы', () => {
  assert.equal(monthsOfYear(2026, '2026-11').length, 11);
  assert.equal(monthsOfYear(2025, '2026-11').length, 12);
});

test('котировка клиенту и обратно', () => {
  const q = clientQuote(1e6, 82.5, DEFAULT_PARAMS);
  near(q, calcDay([{ amount: 1e6, ooo: 1 }], 82.5, DEFAULT_PARAMS, 0).saleUsdt);
  near(rubForUsdt(q, 82.5, DEFAULT_PARAMS), 1e6, 1e-6);
});

test('надбавка к ЦБ в рублях; старый формат в % переводится', () => {
  const r = calcDay([{ amount: 1e6, ooo: 1 }], 80, DEFAULT_PARAMS, 0);
  near(r.units[0].cost.convRate, 81);
  near(r.units[0].sale.convRate, 81);
  const old = { ...structuredClone(DEFAULT_PARAMS), cost: { markupPct: 0.01, hkPct: 0.02 } };
  near(calcDay([{ amount: 1e6, ooo: 1 }], 80, old, 0).units[0].cost.convRate, 81);
});

test('продажа: своё агентское ООО и свой Дубай', () => {
  const p = structuredClone(DEFAULT_PARAMS);
  p.ooo[0].sale.agentPct = 0.02; p.sale.dubai = [m('Комиссия', 1000)];
  const r = calcDay([{ amount: 1e6, ooo: 1 }], 80, p, 1);
  near(r.units[0].sale.usdt, 1e6 * (1 - 0.02) * (1 - 0.025) / 81);
  near(r.saleUsdt, r.saleConvUsdt - 1000);
  near(clientQuote(1e6, 80, p), r.saleConvUsdt);
  const rep = periodReport([{ date: '2026-12-01', ops: [{ amount: 1e6, ooo: 1 }], cb: 80, params: p }], p, { kind: 'month', months: ['2026-12'] });
  near(rep.saleUsdt, rep.saleConvUsdt - 1000);
});

test('у каждого ООО свои проценты; старые общие проценты переносятся во все ООО', () => {
  const p = structuredClone(DEFAULT_PARAMS);
  p.ooo[1].active = true; p.ooo[1].agentPct = 0.03;
  const r = calcDay([{ amount: 1e6, ooo: 1 }, { amount: 1e6, ooo: 2 }], 80, p, 0);
  near(r.units.find(u => u.id === 1).rf.agentRub, 15000);
  near(r.units.find(u => u.id === 2).rf.agentRub, 30000);
  const old = { agentPct: 0.02, bankPct: 0.01, sale: { agentPct: 0.018, markupRub: 1, hkPct: 0.025, dubai: [] }, ooo: DEFAULT_PARAMS.ooo.map(({ agentPct, bankPct, vatPct, vatOnTop, profitTaxPct, sale, ...o }) => o) };
  const r2 = calcDay([{ amount: 1e6, ooo: 1 }], 80, old, 0);
  near(r2.units[0].rf.agentRub, 20000);
  near(r2.units[0].rf.bankRub, 10000);
  near(r2.units[0].sale.usdt, 1e6 * (1 - 0.018) * (1 - 0.025) / 81);
});
