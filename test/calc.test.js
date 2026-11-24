import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcDay, DEFAULT_PARAMS, dayShareOfMonth } from '../calc.js';

const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('совпадает с листом «Модель Рост», колонка E (Дек 26)', () => {
  const cb = 81.7947;
  const p = { ...DEFAULT_PARAMS, cost: { markupPct: 1 / cb, hkPct: 0.0175 }, sale: { markupPct: 0.013, hkPct: 0.025 } };
  const r = calcDay(60_000_000, cb, p, 1); // в таблице расходы — за целый месяц
  near(r.agentRub, 900000);
  near(r.vatRub, 162295.082, 1e-3);
  near(r.bankRub, 300000);
  near(r.taxBaseRub, 87704.91803, 1e-4);
  near(r.profitTaxRub, 21926.22951, 1e-4);
  near(r.oooResultRub, 65778.68852, 1e-4);   // E28 «Сверка»
  near(r.cost.hkRub, 1034250);               // E31
  near(r.cost.beforeConvRub, 58065750);      // E32
  near(r.cost.usdt, 701322.0653, 1e-3);      // E33
  near(r.distributableUsdt, 691322.0653, 1e-3); // E38
  near(r.costRate, 86.79022848, 1e-6);       // E39 внутренний курс структуры
});

test('дни месяца', () => {
  near(dayShareOfMonth('2026-11-17'), 1 / 30);
  near(dayShareOfMonth('2028-02-10'), 1 / 29);
});

test('прибыль = к распределению по себесу − выдача по продаже', () => {
  const r = calcDay(60_000_000, 82.5143, DEFAULT_PARAMS, 1 / 30);
  near(r.profitUsdt, r.distributableUsdt - r.clientUsdt);
  assert.ok(r.saleRate > r.costRate);
  console.log({ costRate: r.costRate, saleRate: r.saleRate, dist: r.distributableUsdt, client: r.clientUsdt, profit: r.profitUsdt, ooo: r.oooResultRub });
});
