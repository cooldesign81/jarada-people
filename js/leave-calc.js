// 휴가·연차 계산 (순수 함수 — 화면/Firebase 없이 테스트 가능)
import { addDays, addMonths, addYears, eachDay, isWeekend, isYmd } from "./dates.js";

export const LEAVE_TYPES = {
  annual:    { label: "연차",        deduct: 1,   cat: "annual" },
  half_am:   { label: "오전 반차",   deduct: 0.5, cat: "annual", half: true },
  half_pm:   { label: "오후 반차",   deduct: 0.5, cat: "annual", half: true },
  sick:      { label: "병가",        cat: "leave" },
  family:    { label: "경조휴가",    cat: "leave" },
  official:  { label: "예비군",      cat: "leave", attach: true },   // 소집 통지서·훈련 참석 확인서를 첨부한다 (저장 키는 예전 ‘공가’ 그대로)
  childcare: { label: "출산·육아",   cat: "leave" },
  other:     { label: "기타 휴가",   cat: "leave" },
};
// 예비군 휴가에 첨부하는 서류
export const ATTACH_KINDS = { notice: "소집 통지서", proof: "훈련 참석 확인서" };
export const LEAVE_STATUS = { submitted: "승인 대기", approved: "승인", rejected: "반려", cancelled: "취소" };
export const statusBadgeCls = { submitted: "s-leave", approved: "s-active", rejected: "off", cancelled: "off" };

export const isOffDay = (date, hol) => isWeekend(date) || hol.has(date);

// 휴가 일수: 반차 0.5, 그 외는 주말·휴일을 뺀 평일 수. hol: 휴일 Map(날짜→이름)
export function countDaysWith(type, start, end, hol) {
  const t = LEAVE_TYPES[type]; if (!t || !isYmd(start)) return 0;
  const e = t.half ? start : end;
  if (!isYmd(e) || e < start) return 0;
  if (t.half) return isOffDay(start, hol) ? 0 : 0.5;
  let n = 0; for (const d of eachDay(start, e)) if (!isOffDay(d, hol)) n++;
  return n;
}

// 연차 계산 (근로기준법 기준, 입사일 기준, 개근 가정)
//  · 1년 미만: 개근한 달마다 1일 (최대 11일)
//  · 1년 이상: 15일, 3년차부터 2년마다 1일 가산 (최대 25일). 입사 기념일부터 1년이 사용 기간
export function annualGrant(hire, asOf) {
  if (!isYmd(hire)) return { ok: false };
  if (asOf < hire) return { ok: true, notStarted: true, years: 0, periodStart: hire, periodEnd: addDays(addYears(hire, 1), -1), granted: 0, kind: "입사 전" };
  let years = 0; while (addYears(hire, years + 1) <= asOf) years++;
  if (years === 0) {
    let months = 0; while (months < 11 && addMonths(hire, months + 1) <= asOf) months++;
    return { ok: true, years, periodStart: hire, periodEnd: addDays(addYears(hire, 1), -1), granted: months, kind: "1년 미만 (개근 월 1일)" };
  }
  return { ok: true, years, periodStart: addYears(hire, years), periodEnd: addDays(addYears(hire, years + 1), -1),
    granted: Math.min(25, 15 + Math.floor((years - 1) / 2)), kind: `${years}년 근속` };
}

export function annualBalance(emp, asOf, leaves) {
  const g = annualGrant(emp?.joinedAt, asOf);
  if (!g.ok) return { ok: false };
  const sum = (status) => leaves.filter((l) => l.employeeId === emp.id && l.status === status && LEAVE_TYPES[l.type]?.deduct
    && l.startDate >= g.periodStart && l.startDate <= g.periodEnd).reduce((a, l) => a + Number(l.days || 0), 0);
  const used = sum("approved"), pending = sum("submitted"), adjust = Number(emp.annualAdjust || 0);
  return { ...g, used, pending, adjust, remaining: g.granted + adjust - used };
}
