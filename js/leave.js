// 휴가·연차: 신청, 승인, 연차 계산, 직원별 현황
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  $, state, can, isHR, isAdmin, isMgr, canApprove, canManage, canSeeBalance, esc, toast, errMsg, orgNames, branchTags, audit, toEmp
} from "./core.js";
import { addDays, addMonths, addYears, eachDay, fmtKo, isWeekend, isYmd, today, monthKey } from "./dates.js";
import { holidayMap } from "./holidays.js";
import { LEAVE_TYPES, LEAVE_STATUS, statusBadgeCls as _statusBadgeCls, countDaysWith, annualBalance as annualBalanceCalc } from "./leave-calc.js";

export { LEAVE_TYPES, LEAVE_STATUS, annualGrant } from "./leave-calc.js";
const statusBadgeCls = _statusBadgeCls;

// ---------- 휴일 (공휴일 + 등록한 휴일) ----------
export function holidaysFor(y1, y2 = y1) {
  const years = []; for (let y = y1; y <= y2; y++) years.push(y);
  return holidayMap(years, state.events);
}

export function countDays(type, start, end) {
  const [y1, y2] = [Number(String(start).slice(0, 4)), Number(String(end || start).slice(0, 4))];
  return countDaysWith(type, start, end, holidaysFor(y1 || 0, Math.max(y1 || 0, y2 || 0)));
}
export const annualBalance = (emp, asOf = today(), leaves = state.leaves) => annualBalanceCalc(emp, asOf, leaves);

// ---------- 불러오기 ----------
export async function loadLeaves() {
  const col = collection(db, "leaveRequests");
  let docs = [];
  if (isHR()) docs = (await getDocs(col)).docs;
  else if (isMgr()) {
    const org = state.role.orgId;
    const [a, b] = await Promise.all([getDocs(query(col, where("orgId", "==", org))), getDocs(query(col, where("orgIds", "array-contains", org)))]);
    const m = new Map(); [...a.docs, ...b.docs].forEach((d) => m.set(d.id, d)); docs = [...m.values()];
  } else if (state.role?.employeeId) docs = (await getDocs(query(col, where("employeeId", "==", state.role.employeeId)))).docs;
  state.leaves = docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => b.startDate.localeCompare(a.startDate));
}
export async function loadEvents() {
  try { state.events = (await getDocs(collection(db, "calendarEvents"))).docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (e) { console.warn("일정 불러오기 실패", e.code || e); state.events = []; }
}

// ---------- 권한 ----------
const myEmpId = () => state.role?.employeeId;
export function canDecide(l) {
  if (!canApprove() || !can("leaveApprove")) return false;
  if (l.employeeId === myEmpId() && !(state.role?.level === "super")) return false;   // 본인 신청은 대표만 처리
  return isHR() || l.orgId === state.role.orgId || (l.orgIds || []).includes(state.role.orgId);
}
export const pendingCount = () => (canApprove() ? state.leaves.filter((l) => l.status === "submitted" && canDecide(l)).length : 0);

// ---------- 목록 화면 ----------
const view = { month: "", status: "", emp: "" };
const empName = (id) => state.employees.find((e) => e.id === id)?.name || "";

export function renderLeaves() {
  const root = $("leavesRoot");
  const me = state.me;
  const parts = [];
  if (me && !canSeeBalance()) {
    // 최고관리자·대표이사가 아니면 남은 연차·계산 내용·안내 문구를 보여 주지 않는다
    parts.push(`<div class="page-head" style="margin:0 0 12px"><span></span><button class="btn btn-primary" id="lvBtnNew">휴가 신청</button></div>`);
  } else if (me) {
    const b = annualBalance(me);
    parts.push(`<div class="card"><div class="head-top"><h2 style="margin:0">내 연차</h2><button class="btn btn-primary" id="lvBtnNew">휴가 신청</button></div>
      ${b.ok ? `<div class="kpis" style="margin:12px 0 0">
        <div class="kpi"><div class="label">올해 발생 (${esc(b.kind)})</div><div class="value">${b.granted}<small>일</small></div></div>
        <div class="kpi"><div class="label">사용</div><div class="value">${b.used}<small>일</small></div></div>
        <div class="kpi"><div class="label">승인 대기</div><div class="value">${b.pending}<small>일</small></div></div>
        <div class="kpi accent"><div class="label">잔여</div><div class="value">${b.remaining}<small>일</small></div></div></div>
        <p class="msg" style="margin:8px 0 0">기간 ${fmtKo(b.periodStart)} ~ ${fmtKo(b.periodEnd)}${b.adjust ? ` · 관리자 조정 ${b.adjust > 0 ? "+" : ""}${b.adjust}일 포함` : ""}. 입사일 기준 법정 연차를 개근으로 가정해 계산한 값입니다.</p>`
        : `<p class="msg" style="margin:8px 0 0">입사일이 등록돼 있지 않아 연차를 계산할 수 없습니다. 관리자에게 입사일 등록을 요청하세요.</p>`}</div>`);
  } else if (canManage()) {
    parts.push(`<div class="page-head" style="margin:0 0 12px"><span></span><button class="btn btn-primary" id="lvBtnNew">휴가 등록</button></div>`);
  }
  if (canApprove()) {
    const pend = state.leaves.filter((l) => l.status === "submitted" && canDecide(l)).sort((a, b) => a.startDate.localeCompare(b.startDate));
    parts.push(`<div class="card flush"><div class="card-head"><h2>승인 대기 <span class="badge s-leave">${pend.length}</span></h2></div>
      <div class="tbl-wrap"><table class="tbl">${pend.length ? `<thead><tr><th>직원</th><th>종류</th><th>기간</th><th class="num">일수</th><th>사유</th><th>신청일</th><th></th></tr></thead><tbody>${
        pend.map((l) => `<tr><td class="strong">${esc(l.employeeName)}</td><td>${esc(LEAVE_TYPES[l.type]?.label || l.type)}</td><td>${periodText(l)}</td><td class="num">${l.days}</td>
          <td class="sub" style="white-space:normal;min-width:140px">${esc(l.reason || "—")}</td><td class="sub">${esc(tsText(l.createdAt))}</td>
          <td><button class="btn btn-primary btn-sm" data-decide="${l.id}">처리</button></td></tr>`).join("")}</tbody>`
        : `<tbody><tr><td class="empty">승인을 기다리는 휴가가 없습니다.</td></tr></tbody>`}</table></div></div>`);
  }
  // 직원별 연차 현황
  if (canSeeBalance()) {
    const emps = state.employees.filter((e) => e.status !== "resigned").sort((a, b) => a.name.localeCompare(b.name, "ko"));
    parts.push(`<div class="card flush"><div class="card-head"><h2>직원별 연차 현황</h2><span class="sub">입사일 기준 법정 연차 · 개근 가정</span></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>소속</th><th>입사일</th><th>구분</th><th class="num">발생</th><th class="num">사용</th><th class="num">대기</th><th class="num">조정</th><th class="num">잔여</th>${canManage() ? "<th></th>" : ""}</tr></thead><tbody>${
      emps.map((e) => { const b = annualBalance(e); return `<tr><td class="strong">${esc(e.name)}</td><td>${branchTags(e.orgIds)}</td><td class="sub">${esc(e.joinedAt || "—")}</td>${b.ok
        ? `<td class="sub">${esc(b.kind)}</td><td class="num">${b.granted}</td><td class="num">${b.used}</td><td class="num">${b.pending}</td><td class="num">${b.adjust || 0}</td><td class="num strong">${b.remaining}</td>`
        : `<td class="sub" colspan="6">입사일 없음</td>`}${canManage() ? `<td><button class="btn btn-secondary btn-sm" data-adjust="${esc(e.id)}">조정</button></td>` : ""}</tr>`; }).join("")}</tbody></table></div></div>`);
  }
  // 내역
  const months = [...new Set(state.leaves.map((l) => monthKey(l.startDate)))].sort().reverse();
  if (!view.month || (view.month !== "all" && !months.includes(view.month))) view.month = months.includes(monthKey(today())) ? monthKey(today()) : (months[0] || "all");
  const list = state.leaves.filter((l) => (view.month === "all" || monthKey(l.startDate) === view.month || monthKey(l.endDate) === view.month)
    && (!view.status || l.status === view.status) && (!view.emp || l.employeeId === view.emp));
  const empOpts = canApprove() ? [...new Map(state.leaves.map((l) => [l.employeeId, l.employeeName])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), "ko")) : [];
  parts.push(`<div class="card flush"><div class="card-head"><h2>휴가 내역</h2><div class="row-actions">
      <select id="lvFltMonth"><option value="all">전체 기간</option>${months.map((m) => `<option value="${m}" ${m === view.month ? "selected" : ""}>${m.replace("-", "년 ")}월</option>`).join("")}</select>
      <select id="lvFltStatus"><option value="">전체 상태</option>${Object.entries(LEAVE_STATUS).map(([k, v]) => `<option value="${k}" ${k === view.status ? "selected" : ""}>${v}</option>`).join("")}</select>
      ${empOpts.length ? `<select id="lvFltEmp"><option value="">전체 직원</option>${empOpts.map(([id, n]) => `<option value="${esc(id)}" ${id === view.emp ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>` : ""}
    </div></div><div class="tbl-wrap"><table class="tbl">${list.length ? `<thead><tr>${canApprove() ? "<th>직원</th>" : ""}<th>종류</th><th>기간</th><th class="num">일수</th><th>사유</th><th>상태</th><th>처리</th><th></th></tr></thead><tbody>${
      list.map((l) => `<tr>${canApprove() ? `<td class="strong">${esc(l.employeeName)}</td>` : ""}<td>${esc(LEAVE_TYPES[l.type]?.label || l.type)}</td><td>${periodText(l)}</td><td class="num">${l.days}</td>
        <td class="sub" style="white-space:normal;min-width:140px">${esc(l.reason || "—")}</td>
        <td><span class="badge ${statusBadgeCls[l.status] || "off"}">${LEAVE_STATUS[l.status] || l.status}</span></td>
        <td class="sub" style="white-space:normal">${l.decidedByName ? esc(l.decidedByName) + (l.decisionNote ? " · " + esc(l.decisionNote) : "") : "—"}</td>
        <td>${actionsFor(l)}</td></tr>`).join("")}</tbody>` : `<tbody><tr><td class="empty">휴가 내역이 없습니다.</td></tr></tbody>`}</table></div></div>`);
  root.innerHTML = parts.join("");
  bindList(root);
}
const periodText = (l) => (l.startDate === l.endDate ? fmtKo(l.startDate) : `${fmtKo(l.startDate)} ~ ${fmtKo(l.endDate)}`);
const tsText = (t) => { const ms = t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0); return ms ? new Date(ms).toLocaleDateString("ko-KR") : ""; };
function actionsFor(l) {
  const mine = l.employeeId === myEmpId();
  const out = [];
  if (canApprove() && canDecide(l) && l.status === "submitted") out.push(`<button class="btn btn-primary btn-sm" data-decide="${l.id}">처리</button>`);
  if (l.status === "submitted" && (mine || canManage())) out.push(`<button class="btn btn-secondary btn-sm" data-cancel="${l.id}">취소</button>`);
  if (l.status === "approved" && canDecide(l)) out.push(`<button class="btn btn-secondary btn-sm" data-decide="${l.id}">변경</button>`);
  return out.join(" ");
}
function bindList(root) {
  $("lvBtnNew")?.addEventListener("click", () => openLeaveDialog());
  root.querySelectorAll("[data-decide]").forEach((b) => b.addEventListener("click", () => openDecision(b.dataset.decide)));
  root.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => cancelLeave(b.dataset.cancel)));
  root.querySelectorAll("[data-adjust]").forEach((b) => b.addEventListener("click", () => openAdjust(b.dataset.adjust)));
  const bindSel = (id, key) => $(id)?.addEventListener("change", (e) => { view[key] = e.target.value; renderLeaves(); });
  bindSel("lvFltMonth", "month"); bindSel("lvFltStatus", "status"); bindSel("lvFltEmp", "emp");
}

// ---------- 신청/등록 ----------
let ctx = { rerender: () => {} };
export function initLeave(c) { ctx = { ...ctx, ...c }; }
const refresh = async () => { await loadLeaves(); ctx.rerender(); };

export function openLeaveDialog({ date = "", employeeId = "" } = {}) {
  const forOthers = canManage();
  const emps = forOthers ? state.employees.filter((e) => e.status !== "resigned").sort((a, b) => a.name.localeCompare(b.name, "ko")) : (state.me ? [state.me] : []);
  if (!emps.length) return toast("직원 정보가 없어 휴가를 신청할 수 없습니다.", true);
  $("lvEmp").innerHTML = emps.map((e) => `<option value="${esc(e.id)}">${esc(e.name)} (${esc(orgNames(e.orgIds))})</option>`).join("");
  $("lvEmp").value = employeeId || (state.me && emps.some((e) => e.id === state.me.id) ? state.me.id : emps[0].id);
  $("lvEmpWrap").classList.toggle("hidden", !forOthers);
  $("lvApproveWrap").classList.toggle("hidden", !forOthers);
  $("lvApprove").checked = false;
  $("lvType").innerHTML = Object.entries(LEAVE_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join("");
  $("lvType").value = "annual";
  $("lvStart").value = date || today(); $("lvEnd").value = date || today(); $("lvReason").value = "";
  $("lvErr").textContent = ""; $("btnLvSave").disabled = false;
  lvRefresh();
  $("dlgLeave").showModal();
}
function lvEmp() { return state.employees.find((e) => e.id === $("lvEmp").value) || state.me; }
function lvRefresh() {
  const t = LEAVE_TYPES[$("lvType").value];
  $("lvEndWrap").classList.toggle("hidden", !!t?.half);
  if (t?.half) $("lvEnd").value = $("lvStart").value;
  const start = $("lvStart").value, end = t?.half ? start : $("lvEnd").value;
  const days = countDays($("lvType").value, start, end);
  let info = days ? `<strong>${days}일</strong> (주말·휴일 제외)` : `<span class="msg error" style="margin:0">선택한 기간에 휴가로 쓸 평일이 없습니다.</span>`;
  const emp = lvEmp();
  if (emp && t?.deduct && canSeeBalance()) {
    const b = annualBalance(emp, isYmd(start) ? start : today());
    if (b.ok) info += ` · 연차 잔여 ${b.remaining}일${days ? ` → 신청 후 ${Math.round((b.remaining - days) * 10) / 10}일` : ""}`;
  }
  $("lvInfo").innerHTML = info;
}
["lvType", "lvStart", "lvEnd", "lvEmp"].forEach((id) => document.addEventListener("input", (e) => { if (e.target.id === id && $("dlgLeave").open) lvRefresh(); }));

function overlap(emp, type, start, end, ignoreId = "") {
  const half = LEAVE_TYPES[type]?.half;
  return state.leaves.find((l) => l.employeeId === emp.id && l.id !== ignoreId && ["submitted", "approved"].includes(l.status) && l.startDate <= end && l.endDate >= start
    && !(half && LEAVE_TYPES[l.type]?.half && l.type !== type));
}
$("btnLvCancel").onclick = () => $("dlgLeave").close();
$("btnLvSave").onclick = async () => {
  const emp = lvEmp(), type = $("lvType").value, t = LEAVE_TYPES[type];
  const start = $("lvStart").value, end = t.half ? start : $("lvEnd").value, reason = $("lvReason").value.trim();
  const err = (m) => { $("lvErr").textContent = m; };
  if (!emp) return err("직원 정보를 찾을 수 없습니다.");
  if (!isYmd(start) || !isYmd(end)) return err("날짜를 선택하세요.");
  if (end < start) return err("종료일이 시작일보다 빠릅니다.");
  const days = countDays(type, start, end);
  if (!days) return err("선택한 기간에 휴가로 쓸 평일이 없습니다.");
  if (reason.length > 500) return err("사유는 500자까지 입력할 수 있습니다.");
  const dup = overlap(emp, type, start, end);
  if (dup) return err(`이미 겹치는 휴가가 있습니다 (${LEAVE_TYPES[dup.type]?.label} ${periodText(dup)}).`);
  const approveNow = canManage() && $("lvApprove").checked;
  const data = { employeeId: emp.id, employeeName: emp.name, orgId: emp.orgId, orgIds: emp.orgIds, type, startDate: start, endDate: end, days, reason,
    status: approveNow ? "approved" : "submitted", createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" };
  if (approveNow) Object.assign(data, { decidedBy: auth.currentUser?.uid || "", decidedByName: state.me?.name || auth.currentUser?.email || "", decidedAt: serverTimestamp(), decisionNote: "관리자 등록" });
  $("btnLvSave").disabled = true;
  try {
    await addDoc(collection(db, "leaveRequests"), data);
    audit(approveNow ? "leave_register" : "leave_request", { targetEmployeeId: emp.id, detail: `${LEAVE_TYPES[type].label} ${start}~${end}` });
    $("dlgLeave").close(); toast(approveNow ? "휴가를 등록했습니다" : "휴가를 신청했습니다"); await refresh();
  } catch (e) { console.error(e); err(errMsg(e)); $("btnLvSave").disabled = false; }
};

async function cancelLeave(id) {
  const l = state.leaves.find((x) => x.id === id); if (!l || !confirm(`${LEAVE_TYPES[l.type]?.label} ${periodText(l)} 휴가를 취소할까요?`)) return;
  try { await updateDoc(doc(db, "leaveRequests", id), { status: "cancelled", updatedAt: serverTimestamp() }); audit("leave_cancel", { targetEmployeeId: l.employeeId, detail: periodText(l) }); toast("취소했습니다"); await refresh(); }
  catch (e) { console.error(e); toast(errMsg(e), true); }
}

// ---------- 승인 ----------
let deciding = null;
export function openDecision(id) {
  const l = state.leaves.find((x) => x.id === id); if (!l) return; deciding = l;
  const b = (() => { const e = state.employees.find((x) => x.id === l.employeeId); return e && canSeeBalance() && LEAVE_TYPES[l.type]?.deduct ? annualBalance(e, l.startDate) : null; })();
  $("dcInfo").innerHTML = `<div class="dl"><dt>직원</dt><dd>${esc(l.employeeName)} ${branchTags(l.orgIds)}</dd><dt>종류</dt><dd>${esc(LEAVE_TYPES[l.type]?.label || l.type)}</dd>
    <dt>기간</dt><dd>${periodText(l)}</dd><dt>사유</dt><dd>${esc(l.reason || "—")}</dd><dt>상태</dt><dd>${LEAVE_STATUS[l.status] || l.status}</dd>
    ${b?.ok ? `<dt>연차 잔여</dt><dd>${b.remaining}일 (발생 ${b.granted} · 사용 ${b.used}${b.pending ? ` · 대기 ${b.pending}` : ""})</dd>` : ""}</div>`;
  $("dcDays").value = l.days; $("dcNote").value = ""; $("dcErr").textContent = "";
  $("btnDcApprove").classList.toggle("hidden", l.status === "approved");
  $("btnDcReject").classList.toggle("hidden", l.status === "rejected");
  $("btnDcCancelLeave").classList.toggle("hidden", l.status !== "approved");
  $("dlgDecision").showModal();
}
async function decide(status) {
  if (!deciding) return;
  const days = Number($("dcDays").value), note = $("dcNote").value.trim();
  if (!(days >= 0 && days <= 365)) { $("dcErr").textContent = "일수를 확인하세요."; return; }
  if (status === "rejected" && !note) { $("dcErr").textContent = "반려 사유를 입력하세요."; return; }
  try {
    await updateDoc(doc(db, "leaveRequests", deciding.id), { status, days, decisionNote: note, decidedBy: auth.currentUser?.uid || "",
      decidedByName: state.me?.name || auth.currentUser?.email || "", decidedAt: serverTimestamp(), updatedAt: serverTimestamp() });
    audit("leave_" + status, { targetEmployeeId: deciding.employeeId, detail: `${LEAVE_TYPES[deciding.type]?.label} ${periodText(deciding)}` });
    $("dlgDecision").close(); toast(status === "approved" ? "승인했습니다" : status === "rejected" ? "반려했습니다" : "취소 처리했습니다"); await refresh();
  } catch (e) { console.error(e); $("dcErr").textContent = errMsg(e); }
}
$("btnDcApprove").onclick = () => decide("approved");
$("btnDcReject").onclick = () => decide("rejected");
$("btnDcCancelLeave").onclick = () => decide("cancelled");
$("btnDcClose").onclick = () => $("dlgDecision").close();

// ---------- 연차 조정 ----------
let adjusting = null;
function openAdjust(id) {
  const e = state.employees.find((x) => x.id === id); if (!e) return; adjusting = e;
  $("adInfo").textContent = `${e.name} · 현재 조정 ${Number(e.annualAdjust || 0)}일`;
  $("adValue").value = Number(e.annualAdjust || 0); $("adErr").textContent = ""; $("dlgAdjust").showModal();
}
$("btnAdCancel").onclick = () => $("dlgAdjust").close();
$("btnAdSave").onclick = async () => {
  const v = Number($("adValue").value);
  if (!Number.isFinite(v) || Math.abs(v) > 100 || Math.round(v * 2) !== v * 2) { $("adErr").textContent = "0.5일 단위로 -100 ~ 100 사이 값을 입력하세요."; return; }
  try {
    await updateDoc(doc(db, "employees", adjusting.id), { annualAdjust: v, updatedAt: serverTimestamp() });
    audit("annual_adjust", { targetEmployeeId: adjusting.id, detail: `조정 ${v}일` });
    adjusting.annualAdjust = v; $("dlgAdjust").close(); toast("조정했습니다"); ctx.rerender();
  } catch (e) { console.error(e); $("adErr").textContent = errMsg(e); }
};
