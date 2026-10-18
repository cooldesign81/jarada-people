// 급여 계산 (순수 함수 — 화면/Firebase 없이 테스트 가능)
import { diffDays } from "./dates.js";

export const num = (v) => Number(String(v ?? "").replace(/,/g, "")) || 0;
export const won = (v) => Math.round(num(v)).toLocaleString("ko-KR") + "원";

// 매달 고정으로 나가는 급여 (인센티브·기타 급여는 변동이라 제외)
export function fixedItems(c = {}) {
  const items = [["기본급", c.baseSalary], ["식대", c.mealAllowance]];
  for (const n of [1, 2, 3]) {
    const amt = c["additionalSalary" + n] ?? (n === 1 ? c.additional : undefined) ?? (n === 1 ? c.additionalSalary : undefined);
    if (num(amt) || c["additionalLabel" + n]) items.push([c["additionalLabel" + n] || `추가급여${n}`, amt]);
  }
  const rows = items.filter(([, a]) => num(a) > 0).map(([label, a]) => ({ label, amount: num(a) }));
  return { rows, total: rows.reduce((s, r) => s + r.amount, 0) };
}

// 퇴직금 예상: 1일 평균임금 × 30일 × 재직일수 ÷ 365. 평균임금은 월 고정급 × 3개월 ÷ 92일로 어림잡는다.
// 상여금·연차수당·인센티브는 넣지 않았으므로 실제 금액과 다를 수 있다.
export function severanceEstimate(emp, comp, asOf, resignDate) {
  if (!emp?.joinedAt) return { ok: false, reason: "입사일이 없습니다." };
  const end = resignDate || asOf, days = diffDays(emp.joinedAt, end) + 1;
  if (days < 1) return { ok: false, reason: "입사일이 기준일보다 늦습니다." };
  const fixed = fixedItems(comp).total;
  if (days < 365) return { ok: true, eligible: false, days, fixed, reason: "재직 1년 미만이라 법정 퇴직금 대상이 아닙니다." };
  const daily = (fixed * 3) / 92;
  return { ok: true, eligible: true, days, fixed, daily: Math.round(daily), amount: Math.round((daily * 30 * days) / 365) };
}
