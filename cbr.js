// Курс ЦБ РФ (USD) на дату. Источник — зеркало cbr-xml-daily.ru (JSON, CORS открыт).
// ЦБ публикует курс один раз в день (~15:30 МСК) сразу на следующий день;
// курс, установленный в субботу, действует в воскресенье и понедельник.

const BASE = 'https://www.cbr-xml-daily.ru';
const CACHE_KEY = 'cbr-cache-v1';

const cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
const save = () => localStorage.setItem(CACHE_KEY, JSON.stringify(cache));

const iso = d => d.toISOString().slice(0, 10);
const addDays = (isoDate, n) => { const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const weekday = isoDate => new Date(isoDate + 'T00:00:00Z').getUTCDay(); // 0 = вс

async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`ЦБ: HTTP ${r.status}`);
  return r.json();
}

/** Последний опубликованный курс: { date, value } */
async function latest() {
  const j = await getJson(`${BASE}/daily_json.js`);
  return { date: j.Date.slice(0, 10), value: j.Valute.USD.Value };
}

/**
 * Курс USD на дату.
 * @returns {Promise<{value:number, date:string, requested:string} | {notPublished:true, latestDate:string}>}
 */
export async function getUsdRate(date) {
  if (cache[date]) return { ...cache[date], requested: date };

  const last = await latest();
  if (date > last.date) {
    // Субботний курс действует до вторника.
    const carried = weekday(last.date) === 6 && date <= addDays(last.date, 2);
    if (!carried) return { notPublished: true, latestDate: last.date };
    return { value: last.value, date: last.date, requested: date };
  }

  // Ищем ближайший опубликованный курс не позже даты (выходные и праздники).
  for (let i = 0, d = date; i < 10; i++, d = addDays(d, -1)) {
    const [y, m, dd] = d.split('-');
    const j = await getJson(`${BASE}/archive/${y}/${m}/${dd}/daily_json.js`);
    if (j) {
      const res = { value: j.Valute.USD.Value, date: d };
      // кешируем только прошлые даты — они уже не изменятся
      if (date < last.date) { cache[date] = res; save(); }
      return { ...res, requested: date };
    }
  }
  throw new Error('ЦБ: курс не найден');
}

export function todayMsk() {
  // дата по Москве (UTC+3), а не по часовому поясу телефона
  return iso(new Date(Date.now() + 3 * 3600 * 1000));
}
export { addDays };
