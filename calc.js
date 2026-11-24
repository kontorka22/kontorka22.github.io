// Расчёт операционного дня по структуре потока РФ → Гонконг → Дубай.
// Повторяет лист «Модель Рост» финмодели (строки 19–46, кроме строки 45).

export const DEFAULT_PARAMS = {
  // РФ — ООО
  agentPct: 0.015,        // агентское вознаграждение ООО, % от потока
  vatPct: 0.22,           // НДС
  vatOnTop: false,        // false — НДС внутри вознаграждения (22/122)
  bankPct: 0.005,         // комиссия банка РФ, % от потока (под вопросом)
  payrollMonthRub: 350000,// ФОТ и налоги на ЗП, руб./мес
  profitTaxPct: 0.25,     // налог на прибыль
  // Гонконг — себес и продажа
  cost: { markupPct: 0.01, hkPct: 0.02 },   // курс ЦБ +1%, комиссия ГК 2%
  sale: { markupPct: 0.013, hkPct: 0.025 }, // курс ЦБ +1,3%, комиссия ГК 2,5%
  // Дубай
  dubaiNominalUsdMonth: 5000,   // номинал
  dubaiAccountingUsdMonth: 5000,// бух, аудит, резерв на продление лицензии
};

/** Доля месяца, приходящаяся на один календарный день (постоянные расходы делятся по дням). */
export function dayShareOfMonth(isoDate) {
  const [y, m] = isoDate.split('-').map(Number);
  return 1 / new Date(y, m, 0).getDate();
}

function path(transitRub, cb, { markupPct, hkPct }) {
  const hkRub = transitRub * hkPct;
  const beforeConvRub = transitRub - hkRub;
  const convRate = cb * (1 + markupPct);
  return { markupPct, hkPct, hkRub, beforeConvRub, convRate, usdt: convRate > 0 ? beforeConvRub / convRate : 0 };
}

/**
 * @param {number} flow  входящий поток за день, руб.
 * @param {number} cb    курс ЦБ, руб./USD
 * @param {object} p     параметры (DEFAULT_PARAMS)
 * @param {number} share доля месяца для постоянных расходов (1/дней в месяце; 1 = целый месяц)
 */
export function calcDay(flow, cb, p, share) {
  // РФ
  const agentRub = flow * p.agentPct;
  const vatRub = p.vatOnTop ? agentRub * p.vatPct : (agentRub * p.vatPct) / (1 + p.vatPct);
  const retainedRub = agentRub + (p.vatOnTop ? vatRub : 0);  // удержано ООО из потока
  const oooRevenueRub = p.vatOnTop ? agentRub : agentRub - vatRub;
  const bankRub = flow * p.bankPct;
  const payrollRub = p.payrollMonthRub * share;
  const taxBaseRub = Math.max(0, oooRevenueRub - bankRub - payrollRub);
  const profitTaxRub = taxBaseRub * p.profitTaxPct;
  const oooResultRub = oooRevenueRub - bankRub - payrollRub - profitTaxRub; // «Сверка»

  // Гонконг
  const transitRub = flow - retainedRub;
  const cost = path(transitRub, cb, p.cost);
  const sale = path(transitRub, cb, p.sale);

  // Дубай (постоянные расходы — только в себесе)
  const dubaiUsd = (p.dubaiNominalUsdMonth + p.dubaiAccountingUsdMonth) * share;
  const distributableUsdt = cost.usdt - dubaiUsd;   // к распределению по себесу
  const clientUsdt = sale.usdt;                     // выдача клиенту по курсу продажи

  const costRate = distributableUsdt > 0 ? flow / distributableUsdt : 0; // внутренний курс структуры
  const saleRate = clientUsdt > 0 ? flow / clientUsdt : 0;               // курс продажи
  const profitUsdt = distributableUsdt - clientUsdt;

  return {
    flow, cb, share,
    agentRub, vatRub, retainedRub, oooRevenueRub, bankRub, payrollRub,
    taxBaseRub, profitTaxRub, oooResultRub,
    transitRub, cost, sale,
    dubaiUsd, distributableUsdt, clientUsdt,
    costRate, saleRate, profitUsdt,
    profitPct: flow > 0 && cb > 0 ? profitUsdt / (flow / cb) : 0,
  };
}

/** Сумма дней за период (каждый день — со своим курсом и параметрами-снимком). */
export function sumDays(results) {
  const keys = ['flow', 'agentRub', 'vatRub', 'oooRevenueRub', 'bankRub', 'payrollRub', 'profitTaxRub',
    'oooResultRub', 'transitRub', 'dubaiUsd', 'distributableUsdt', 'clientUsdt', 'profitUsdt'];
  const t = Object.fromEntries(keys.map(k => [k, 0]));
  t.costHkRub = 0; t.saleHkRub = 0;
  for (const r of results) {
    for (const k of keys) t[k] += r[k];
    t.costHkRub += r.cost.hkRub; t.saleHkRub += r.sale.hkRub;
  }
  t.costRate = t.distributableUsdt > 0 ? t.flow / t.distributableUsdt : 0;
  t.saleRate = t.clientUsdt > 0 ? t.flow / t.clientUsdt : 0;
  t.days = results.length;
  return t;
}
