import { annualGrant, annualBalance, countDaysWith } from "../../js/leave-calc.js";
import { builtinHolidays } from "../../js/holidays.js";
let f = 0; const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) f++; console.log(ok ? "PASS" : "FAIL", n, ok ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)); };
const g = (h, d) => { const r = annualGrant(h, d); return [r.granted, r.periodStart, r.periodEnd]; };
eq("입사 직후", g("2026-03-02", "2026-03-02"), [0, "2026-03-02", "2027-03-01"]);
eq("1개월 지남", g("2026-03-02", "2026-04-02"), [1, "2026-03-02", "2027-03-01"]);
eq("11개월", g("2026-03-02", "2027-02-20"), [11, "2026-03-02", "2027-03-01"]);
eq("1주년 당일 15일", g("2026-03-02", "2027-03-02"), [15, "2027-03-02", "2028-03-01"]);
eq("2년차 15일", g("2026-03-02", "2028-03-02"), [15, "2028-03-02", "2029-03-01"]);
eq("3년차 16일", g("2026-03-02", "2029-03-02"), [16, "2029-03-02", "2030-03-01"]);
eq("5년차 17일", g("2026-03-02", "2031-03-02"), [17, "2031-03-02", "2032-03-01"]);
eq("21년차 25일(상한)", annualGrant("2000-01-01", "2026-06-01").granted, 25);
eq("말일 입사 1/31", g("2026-01-31", "2026-02-28"), [1, "2026-01-31", "2027-01-30"]);
eq("2/29 입사 → 평년 기념일 2/28", g("2024-02-29", "2025-02-28"), [15, "2025-02-28", "2026-02-27"]);
const hol = builtinHolidays(2026);
eq("연차 5일(주말 포함 기간)", countDaysWith("annual", "2026-11-02", "2026-11-08", hol), 5);
eq("추석 연휴 제외", countDaysWith("annual", "2026-09-23", "2026-09-29", new Map([...builtinHolidays(2026)])), 3);
eq("반차 0.5", countDaysWith("half_am", "2026-11-03", "2026-11-03", hol), 0.5);
eq("공휴일 반차 0", countDaysWith("half_pm", "2026-10-09", "2026-10-09", hol), 0);
eq("주말만 0", countDaysWith("annual", "2026-11-07", "2026-11-08", hol), 0);
const emp = { id: "e1", joinedAt: "2020-01-01", annualAdjust: 2 };
const lv = [
  { employeeId: "e1", type: "annual", status: "approved", startDate: "2026-02-02", days: 3 },
  { employeeId: "e1", type: "half_am", status: "approved", startDate: "2026-03-03", days: 0.5 },
  { employeeId: "e1", type: "sick", status: "approved", startDate: "2026-03-10", days: 2 },
  { employeeId: "e1", type: "annual", status: "submitted", startDate: "2026-05-04", days: 1 },
  { employeeId: "e1", type: "annual", status: "approved", startDate: "2025-12-30", days: 4 },
  { employeeId: "e2", type: "annual", status: "approved", startDate: "2026-02-02", days: 9 },
];
const b = annualBalance(emp, "2026-06-01", lv);
eq("잔여 계산 (2020입사: 6년→17일, 사용 3.5, 대기 1, 조정 +2)", [b.granted, b.used, b.pending, b.adjust, b.remaining], [17, 3.5, 1, 2, 15.5]);
console.log(f ? f + " FAILURE(S)" : "ALL PASS");
