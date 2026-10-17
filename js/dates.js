// 날짜 유틸 (YYYY-MM-DD 문자열 기준, 시간대 영향 없이 로컬 날짜로 계산)
export const pad = (n) => String(n).padStart(2, "0");
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
export const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")) && ymd(parse(s)) === s;
export const today = () => ymd(new Date());
export const dow = (s) => parse(s).getDay();                 // 0=일 … 6=토
export const isWeekend = (s) => dow(s) === 0 || dow(s) === 6;
export function addDays(s, n) { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
export function addMonths(s, n) {                           // 말일 보정 (1/31 + 1개월 = 2/28)
  const d = parse(s), day = d.getDate();
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  t.setDate(Math.min(day, last));
  return ymd(t);
}
export const addYears = (s, n) => addMonths(s, n * 12);
export function* eachDay(start, end) { for (let d = start; d <= end; d = addDays(d, 1)) yield d; }
export const monthKey = (s) => String(s).slice(0, 7);
export function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }   // m: 1~12
export const weekdayKo = (s) => "일월화수목금토"[dow(s)];
export function fmtKo(s) { if (!s) return "—"; const d = parse(s); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}(${weekdayKo(s)})`; }
export function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
