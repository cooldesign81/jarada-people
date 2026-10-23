// 회사 지정 휴가(하계휴가 등): 달력에 등록한 일정(종류 ‘회사 지정 휴가’)의 기간을 직원들의 연차에서 한꺼번에 차감한다.
// 직원마다 ‘승인된 연차’ 한 건(leaveRequests, source:"company", eventId)을 만들므로 연차 잔여·휴가 내역에 그대로 반영되고,
// 취소하면 그 건들을 ‘취소’로 바꿔 연차가 되돌아간다.
import { db, auth } from "./firebase.js";
import { collection, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, canSeeBalance, esc, toast, errMsg, audit, orgNames } from "./core.js";
import { countDaysWith } from "./leave-calc.js";
import { holidaysFor, annualBalance, loadLeaves } from "./leave.js";
import { fmtKo } from "./dates.js";
import { holidayMap } from "./holidays.js";

export const isCompanyLeave = (ev) => ev?.kind === "companyLeave";
export const appliedLeaves = (ev) => state.leaves.filter((l) => l.eventId === ev.id && ["submitted", "approved"].includes(l.status));
const periodText = (ev) => (ev.endDate && ev.endDate !== ev.startDate ? `${fmtKo(ev.startDate)} ~ ${fmtKo(ev.endDate)}` : fmtKo(ev.startDate));

// 대상 직원과 직원별 계산 (화면에 미리 보여 주는 표)
export function planCompanyLeave(ev) {
  const end = ev.endDate || ev.startDate, hol = holidaysFor(Number(ev.startDate.slice(0, 4)), Number(end.slice(0, 4)));
  const days = countDaysWith("annual", ev.startDate, end, hol);
  // 같은 기간이 ‘휴일’ 종류 일정으로 이미 등록돼 있으면 그 날은 연차 일수에서 빠진다 → 안내용으로 얼마나 빠졌는지 센다
  const y1 = Number(ev.startDate.slice(0, 4)), y2 = Number(end.slice(0, 4)), noCustom = holidayMap(Array.from({ length: y2 - y1 + 1 }, (_, i) => y1 + i), []);
  const excludedByHolidayEvent = countDaysWith("annual", ev.startDate, end, noCustom) - days;
  const targets = state.employees.filter((e) => e.status === "active" && (!ev.orgIds?.length || e.orgIds.some((o) => ev.orgIds.includes(o))));
  const rows = targets.map((emp) => {
    const done = state.leaves.find((l) => l.eventId === ev.id && l.employeeId === emp.id && ["submitted", "approved"].includes(l.status));
    const clash = state.leaves.find((l) => l.employeeId === emp.id && l.eventId !== ev.id && ["submitted", "approved"].includes(l.status) && l.startDate <= end && l.endDate >= ev.startDate);
    const b = emp.joinedAt ? annualBalance(emp, ev.startDate) : { ok: false };
    let skip = "";
    if (done) skip = "이미 차감됨";
    else if (!emp.joinedAt) skip = "입사일이 없어 연차를 계산할 수 없음";
    else if (emp.joinedAt > ev.startDate) skip = "휴가 기간 중에 입사";
    else if (clash) skip = "겹치는 휴가가 이미 있음";
    const short = !skip && b.ok && b.remaining < days;
    return { emp, days, remaining: b.ok ? b.remaining : null, skip, short, done: !!done, checked: !skip && !short };
  });
  rows.sort((a, b) => Number(!!a.skip) - Number(!!b.skip) || Number(a.short) - Number(b.short) || a.emp.name.localeCompare(b.emp.name, "ko"));
  return { days, rows, excludedByHolidayEvent };
}

let cur = null;
export function openCompanyLeaveDialog(ev, after) {
  const plan = planCompanyLeave(ev); cur = { ev, plan, after };
  $("clTitle").textContent = `‘${ev.title}’ 연차 차감`;
  $("clErr").textContent = "";
  const holNote = plan.excludedByHolidayEvent > 0 ? `<div class="msg" style="margin:8px 0 0">이 기간 중 평일 <b>${plan.excludedByHolidayEvent}일</b>은 종류가 ‘휴일’인 일정으로 등록돼 있어 연차 계산에서 제외했습니다. 연차에서 차감하려면 그 일정의 종류를 <b>‘회사 지정 휴가’</b>로 바꾸세요 (같은 기간에 일정이 두 개 있으면 하나는 지우세요).</div>` : "";
  if (!plan.days) { $("clInfo").innerHTML = `<div class="msg error" style="margin:0">이 기간에는 연차로 쓸 평일이 없습니다 (주말·공휴일만 있음).</div>${holNote}`; $("clTable").innerHTML = ""; $("btnClApply").disabled = true; $("dlgCompanyLeave").showModal(); return; }
  $("clInfo").innerHTML = `<b>${esc(periodText(ev))}</b> · 연차 <b>${plan.days}일</b> 차감 · 대상 ${esc(ev.orgIds?.length ? orgNames(ev.orgIds) : "전체 지점")} 재직 직원<br><span class="sub">주말·공휴일은 빼고 계산합니다. 연차가 모자란 직원, 이미 겹치는 휴가가 있는 직원은 기본으로 빠져 있으니 필요하면 직접 체크하세요. (연차가 부족한 직원을 체크하면 잔여가 마이너스가 됩니다)</span>`;
  $("clInfo").innerHTML += holNote;
  $("clTable").innerHTML = `<thead><tr><th><input type="checkbox" id="clAll" title="전체 선택"></th><th>이름</th><th>소속</th><th class="num">차감</th>${canSeeBalance() ? '<th class="num">현재 잔여</th><th class="num">차감 후</th>' : ""}<th>비고</th></tr></thead><tbody>${plan.rows.map((r, i) => `<tr class="${r.skip ? "sub" : ""}">
    <td><input type="checkbox" data-cl="${i}" ${r.checked ? "checked" : ""} ${r.skip ? "disabled" : ""}></td><td class="strong">${esc(r.emp.name)}</td><td class="sub">${esc(orgNames(r.emp.orgIds))}</td>
    <td class="num">${r.skip ? "—" : r.days}</td>${canSeeBalance() ? `<td class="num">${r.remaining === null ? "—" : r.remaining}</td><td class="num ${r.short ? "bad" : ""}">${r.remaining === null || r.skip ? "—" : Math.round((r.remaining - r.days) * 10) / 10}</td>` : ""}
    <td class="sub ${r.short ? "bad" : ""}">${esc(r.skip || (r.short ? "연차 부족" : ""))}</td></tr>`).join("")}</tbody>`;
  const boxes = () => [...$("clTable").querySelectorAll("[data-cl]:not(:disabled)")];
  const sync = () => { const n = boxes().filter((b) => b.checked).length; $("btnClApply").textContent = n ? `${n}명 연차 차감` : "차감할 직원을 선택하세요"; $("btnClApply").disabled = !n; };
  $("clAll").onchange = () => { boxes().forEach((b) => (b.checked = $("clAll").checked)); sync(); };
  boxes().forEach((b) => (b.onchange = sync)); sync();
  $("dlgCompanyLeave").showModal();
}
$("btnClCancel").onclick = () => $("dlgCompanyLeave").close();
$("btnClApply").onclick = async () => {
  if (!cur) return; const { ev, plan } = cur;
  const picks = [...$("clTable").querySelectorAll("[data-cl]:checked")].map((b) => plan.rows[Number(b.dataset.cl)]);
  if (!picks.length) return;
  if (!confirm(`${picks.length}명의 연차에서 ${plan.days}일씩 차감합니다 (${ev.title}). 계속할까요?`)) return;
  $("btnClApply").disabled = true; $("clErr").textContent = ""; let ok = 0, fail = 0;
  const me = auth.currentUser?.uid || "";
  for (const r of picks) {
    try {
      await addDoc(collection(db, "leaveRequests"), {
        employeeId: r.emp.id, employeeName: r.emp.name, orgId: r.emp.orgId, orgIds: r.emp.orgIds, type: "annual", startDate: ev.startDate, endDate: ev.endDate || ev.startDate,
        days: plan.days, reason: `${ev.title} (회사 지정 휴가)`, status: "approved", source: "company", eventId: ev.id,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: me,
        decidedBy: me, decidedByName: state.me?.name || auth.currentUser?.email || "", decidedAt: serverTimestamp(), decisionNote: "회사 지정 휴가",
      });
      ok++;
    } catch (e) { console.error(e); fail++; }
    $("btnClApply").textContent = `차감 중… ${ok + fail}/${picks.length}`;
  }
  audit("company_leave_apply", { detail: `${ev.title} ${plan.days}일 · ${ok}명${fail ? ` (실패 ${fail}명)` : ""}` });
  await loadLeaves(); $("dlgCompanyLeave").close(); toast(`${ok}명의 연차에서 차감했습니다${fail ? `, ${fail}명 실패` : ""}`, !!fail); cur.after?.();
};

// 차감 취소: 이 일정으로 만든 휴가를 ‘취소’로 바꿔 연차를 되돌린다
export async function revokeCompanyLeave(ev) {
  const list = appliedLeaves(ev); if (!list.length) return 0;
  let ok = 0;
  for (const l of list) {
    try { await updateDoc(doc(db, "leaveRequests", l.id), { status: "cancelled", decisionNote: "회사 지정 휴가 취소", decidedBy: auth.currentUser?.uid || "", decidedByName: state.me?.name || auth.currentUser?.email || "", decidedAt: serverTimestamp(), updatedAt: serverTimestamp() }); ok++; }
    catch (e) { console.error(e); }
  }
  audit("company_leave_revoke", { detail: `${ev.title} ${ok}/${list.length}명` });
  await loadLeaves(); return ok;
}
