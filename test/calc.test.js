import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcDay, DEFAULT_PARAMS, dayShareOfMonth, monthReport, clientQuote, rubForUsdt, lumpExpenses, normalizeParams } from '../calc.js';

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('совпадает с листом «Модель Рост», колонка E (Дек 26)', () => {
  const cb = 81.7947;
  const p = { ...structuredClone(DEFAULT_PARAMS), cost: { markupPct: 1 / cb, hkPct: 0.0175 } };
  const r = calcDay(60_000_000, cb, p, 1); // в таблице расходы — за целый месяц
  near(r.agentRub, 900000);
  near(r.vatRub, 162295.082, 1e-3);
  near(r.bankRub, 300000);
  near(r.taxBaseRub, 87704.91803);
  near(r.profitTaxRub, 21926.22951);
  near(r.oooResultRub, 65778.68852);      // E28 «Сверка»
  near(r.cost.hkRub, 1034250);            // E31
  near(r.cost.beforeConvRub, 58065750);   // E32
  near(r.cost.usdt, 701322.0653, 1e-3);   // E33
  near(r.distributableUsdt, 691322.0653, 1e-3); // E38
  near(r.costRate, 86.79022848, 1e-6);    // E39
});

test('статьи расходов: сумма статей = расход уровня', () => {
  const p = structuredClone(DEFAULT_PARAMS);
  p.expenses.find(e => e.id === 'ru-payroll').amount = 300000;
  p.expenses.find(e => e.id === 'ru-payroll-tax').amount = 50000;
  near(calcDay(1e6, 80, p, 1).ruFixedRub, 350000);
  near(calcDay(1e6, 80, p, 1).aeFixedUsd, 10000);
});

test('годовые и разовые статьи', () => {
  const names = ym => lumpExpenses(DEFAULT_PARAMS, ym).map(e => e.id).sort();
  assert.ok(names('2026-11').includes('ru-capital') && names('2026-11').includes('ae-accounts'));
  assert.ok(!names('2027-11').includes('ru-capital') && names('2027-11').includes('ae-license'));
  assert.equal(names('2027-01').length, 0);
});

test('месяц: постоянные расходы за полный месяц', () => {
  const p = structuredClone(DEFAULT_PARAMS);
  const days = [{ date: '2026-12-01', flow: 6e7, cb: 82, params: p }];
  const m = monthReport(days, p, '2026-12');
  near(m.netUsdt, m.marginUsdt - 10000);
  near(m.ruFixedRub, 350000);
});

test('котировка клиенту и обратно', () => {
  const q = clientQuote(1e6, 82.5143, DEFAULT_PARAMS);
  near(q, calcDay(1e6, 82.5143, DEFAULT_PARAMS, 0).clientUsdt);
  near(rubForUsdt(q, 82.5143, DEFAULT_PARAMS), 1e6, 1e-6);
});

test('старый формат параметров', () => {
  const p = normalizeParams({ agentPct: 0.015, payrollMonthRub: 400000 });
  near(calcDay(1e6, 80, p, 1).ruFixedRub, 400000);
});

test('дни месяца', () => { near(dayShareOfMonth('2028-02-10'), 1 / 29); });
