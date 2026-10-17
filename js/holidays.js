// 공휴일 (참고용). 양력 고정 공휴일은 매년 자동, 음력 기반(설날·추석·부처님오신날)과 임시공휴일은 아래 표에 있는 해만 포함.
// 표에 없는 해나 정부가 새로 정한 휴일은 달력의 ‘일정 추가 → 휴일’로 직접 등록하세요.
import { addDays, dow, isWeekend, ymd } from "./dates.js";

const FIXED = [
  [1, 1, "신정"], [3, 1, "삼일절"], [5, 5, "어린이날"], [6, 6, "현충일"],
  [8, 15, "광복절"], [10, 3, "개천절"], [10, 9, "한글날"], [12, 25, "성탄절"],
];
const SUBSTITUTE = new Set(["삼일절", "어린이날", "광복절", "개천절", "한글날", "성탄절", "부처님오신날"]);   // 토·일과 겹치면 대체공휴일
const LUNAR = {
  2026: { seollal: ["2026-02-16", "2026-02-17", "2026-02-18"], buddha: "2026-05-24", chuseok: ["2026-09-24", "2026-09-25", "2026-09-26"], extra: [["2026-06-03", "전국동시지방선거"]] },
  2027: { seollal: ["2027-02-05", "2027-02-06", "2027-02-07"], buddha: "2027-05-13", chuseok: ["2027-09-14", "2027-09-15", "2027-09-16"], extra: [] },
};
export const LUNAR_YEARS = Object.keys(LUNAR).map(Number);

const cache = new Map();
export function builtinHolidays(year) {
  if (cache.has(year)) return cache.get(year);
  const map = new Map();
  const pad = (n) => String(n).padStart(2, "0");
  for (const [m, d, name] of FIXED) map.set(`${year}-${pad(m)}-${pad(d)}`, name);
  const L = LUNAR[year];
  const groups = [];   // 대체공휴일 판정 단위: { dates, name }
  for (const [date, name] of map) groups.push({ dates: [date], name });
  if (L) {
    for (const [d, n] of L.extra) map.set(d, n);
    L.seollal.forEach((d, i) => map.set(d, i === 1 ? "설날" : "설날 연휴"));
    L.chuseok.forEach((d, i) => map.set(d, i === 1 ? "추석" : "추석 연휴"));
    map.set(L.buddha, "부처님오신날");
    groups.push({ dates: L.seollal, name: "설날", sundayOnly: true }, { dates: L.chuseok, name: "추석", sundayOnly: true }, { dates: [L.buddha], name: "부처님오신날" });
  }
  // 대체공휴일: 빠른 날짜부터 처리
  groups.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  for (const g of groups) {
    const overlaps = g.sundayOnly
      ? g.dates.some((d) => dow(d) === 0)
      : SUBSTITUTE.has(g.name) && g.dates.some((d) => isWeekend(d));
    if (!overlaps) continue;
    let d = addDays(g.dates[g.dates.length - 1], 1);
    while (isWeekend(d) || map.has(d)) d = addDays(d, 1);
    map.set(d, `${g.name} 대체공휴일`);
  }
  cache.set(year, map);
  return map;
}

// 여러 해 + 사용자가 등록한 휴일(calendarEvents kind=holiday)을 합친 { 날짜: 이름 }
export function holidayMap(years, customEvents = []) {
  const out = new Map();
  for (const y of years) for (const [d, n] of builtinHolidays(y)) out.set(d, n);
  for (const ev of customEvents) {
    if (ev.kind !== "holiday" || !ev.startDate) continue;
    for (let d = ev.startDate; d <= (ev.endDate || ev.startDate); d = addDays(d, 1)) out.set(d, ev.title || "휴일");
  }
  return out;
}
