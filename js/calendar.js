// 달력: 생일, 연차, 휴가, 휴일, 일정
import { db, auth } from "./firebase.js";
import {
  collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, isHR, isAdmin, canManage, canApprove, esc, toast, errMsg, orgName, renderOrgChecks, readOrgChecks, audit } from "./core.js";
import { addDays, daysInMonth, dow, eachDay, fmtKo, isYmd, pad, today, weekdayKo, parse } from "./dates.js";
import { LEAVE_TYPES, LEAVE_STATUS, holidaysFor, loadEvents, openLeaveDialog, openDecision, canDecide } from "./leave.js";

const CATS = {
  birthday: { label: "생일" }, annual: { label: "연차·반차" }, leave: { label: "휴가" }, holiday: { label: "휴일" }, event: { label: "일정·행사" },
};
const cal = { y: 0, m: 0, org: "", cats: new Set(Object.keys(CATS)), loaded: false };
let ctx = { rerender: () => {} };
export function initCalendar(c) { ctx = { ...ctx, ...c }; }

function ensureMonth() { if (!cal.y) { const t = today(); cal.y = Number(t.slice(0, 4)); cal.m = Number(t.slice(5, 7)); } }
const inOrg = (orgIds) => !cal.org || (orgIds || []).includes(cal.org);
const monthDates = () => { const first = `${cal.y}-${pad(cal.m)}-01`; return { first, last: `${cal.y}-${pad(cal.m)}-${pad(daysInMonth(cal.y, cal.m))}` }; };

// 해당 월(앞뒤 주 포함)의 날짜별 이벤트
function buildEvents(from, to) {
  const out = new Map(); const add = (d, e) => { if (d < from || d > to) return; if (!out.has(d)) out.set(d, []); out.get(d).push(e); };
  const y1 = Number(from.slice(0, 4)), y2 = Number(to.slice(0, 4));
  const hol = holidaysFor(y1, y2);
  for (const [d, name] of hol) add(d, { cat: "holiday", title: name, sub: "휴일", builtin: true });
  // 생일 (매년 반복). 2/29 생일은 평년에 2/28
  for (const e of state.employees) {
    if (e.status === "resigned" || !isYmd(e.birthDate) || !inOrg(e.orgIds)) continue;
    for (let y = y1; y <= y2; y++) {
      let md = e.birthDate.slice(5);
      if (md === "02-29" && daysInMonth(y, 2) < 29) md = "02-28";
      add(`${y}-${md}`, { cat: "birthday", title: e.name, sub: "생일", empId: e.id });
    }
  }
  // 휴가·연차 (승인 + 승인 대기). 주말·휴일은 건너뜀
  for (const l of state.leaves) {
    if (!["approved", "submitted"].includes(l.status) || !inOrg(l.orgIds)) continue;
    if (l.endDate < from || l.startDate > to) continue;
    const t = LEAVE_TYPES[l.type] || { label: l.type, cat: "leave" };
    for (const d of eachDay(l.startDate < from ? from : l.startDate, l.endDate > to ? to : l.endDate)) {
      if (dow(d) === 0 || dow(d) === 6 || hol.has(d)) continue;
      add(d, { cat: t.cat, title: l.employeeName, sub: t.label + (l.status === "submitted" ? " (대기)" : ""), pending: l.status === "submitted", leaveId: l.id });
    }
  }
  // 등록한 일정 (휴일은 위에서 이미 반영됨)
  for (const ev of state.events) {
    if (ev.kind === "holiday" || !isYmd(ev.startDate)) continue;
    if (cal.org && ev.orgIds?.length && !ev.orgIds.includes(cal.org)) continue;
    const end = ev.endDate && ev.endDate >= ev.startDate ? ev.endDate : ev.startDate;
    if (end < from || ev.startDate > to) continue;
    for (const d of eachDay(ev.startDate < from ? from : ev.startDate, end > to ? to : end)) add(d, { cat: "event", title: ev.title, sub: ev.kind === "training" ? "교육" : "일정", eventId: ev.id });
  }
  for (const list of out.values()) list.sort((a, b) => (a.cat === "holiday" ? -1 : b.cat === "holiday" ? 1 : 0) || a.cat.localeCompare(b.cat) || String(a.title).localeCompare(String(b.title), "ko"));
  return out;
}

export async function renderCalendar() {
  ensureMonth();
  if (!cal.loaded) { cal.loaded = true; if (!state.events.length) await loadEvents(); }
  const { first, last } = monthDates();
  const gridStart = addDays(first, -dow(first)), gridEnd = addDays(last, 6 - dow(last));
  const events = buildEvents(gridStart, gridEnd);
  $("calTitle").textContent = `${cal.y}년 ${cal.m}월`;
  // 지점 필터
  const orgSel = $("calOrg");
  orgSel.classList.toggle("hidden", !isHR());
  if (isHR()) { orgSel.innerHTML = `<option value="">전체 지점</option>` + state.orgs.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join(""); orgSel.value = cal.org; }
  $("btnEventNew").classList.toggle("hidden", !canManage());
  $("calFilters").innerHTML = Object.entries(CATS).map(([k, v]) => `<label class="cal-chk cat-${k}"><input type="checkbox" data-cat="${k}" ${cal.cats.has(k) ? "checked" : ""}><span class="dot"></span>${v.label}</label>`).join("");
  $("calFilters").querySelectorAll("input").forEach((i) => i.addEventListener("change", () => { i.checked ? cal.cats.add(i.dataset.cat) : cal.cats.delete(i.dataset.cat); renderCalendar(); }));
  // 격자
  const t = today();
  let html = `<div class="cal-head">${"일월화수목금토".split("").map((d, i) => `<div class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${d}</div>`).join("")}</div><div class="cal-body">`;
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) {
    const evs = (events.get(d) || []).filter((e) => cal.cats.has(e.cat));
    const hol = evs.find((e) => e.cat === "holiday");
    const items = evs.filter((e) => e.cat !== "holiday");
    const inMonth = d >= first && d <= last;
    html += `<div class="cal-cell ${inMonth ? "" : "dim"} ${d === t ? "today" : ""} ${dow(d) === 0 || hol ? "sun" : dow(d) === 6 ? "sat" : ""}" data-date="${d}">
      <div class="cal-num"><span>${Number(d.slice(8))}</span>${hol ? `<em class="hol">${esc(hol.title)}</em>` : ""}</div>
      <div class="cal-items">${items.slice(0, 3).map(chip).join("")}${items.length > 3 ? `<div class="cal-more">+${items.length - 3}</div>` : ""}</div>
      <div class="cal-dots">${items.slice(0, 6).map((e) => `<i class="dot cat-${e.cat}"></i>`).join("")}</div></div>`;
  }
  $("calGrid").innerHTML = html + "</div>";
  $("calGrid").querySelectorAll(".cal-cell").forEach((c) => c.addEventListener("click", () => openDay(c.dataset.date, events)));
  // 이번 달 목록
  const rows = [];
  for (const d of eachDay(first, last)) {
    const evs = (events.get(d) || []).filter((e) => cal.cats.has(e.cat));
    if (evs.length) rows.push(`<div class="agenda-day"><div class="agenda-date ${dow(d) === 0 ? "sun" : dow(d) === 6 ? "sat" : ""}">${Number(d.slice(8))}일 <small>(${weekdayKo(d)})</small></div><div class="agenda-items">${evs.map((e) => `<span class="chip cat-${e.cat} ${e.pending ? "pending" : ""}"><b>${esc(e.title)}</b> ${esc(e.sub)}</span>`).join("")}</div></div>`);
  }
  $("calAgenda").innerHTML = rows.join("") || `<div class="empty">이번 달 일정이 없습니다.</div>`;
}
const chip = (e) => `<div class="chip cat-${e.cat} ${e.pending ? "pending" : ""}" title="${esc(e.title)} · ${esc(e.sub)}"><b>${esc(e.title)}</b> ${esc(e.sub)}</div>`;

// ---------- 날짜 상세 ----------
let dayOpen = "";
function openDay(date, events) {
  dayOpen = date;
  const evs = (events.get(date) || []).filter((e) => cal.cats.has(e.cat));
  $("dayTitle").textContent = fmtKo(date);
  $("dayList").innerHTML = evs.length ? evs.map((e) => {
    const l = e.leaveId ? state.leaves.find((x) => x.id === e.leaveId) : null;
    const ev = e.eventId ? state.events.find((x) => x.id === e.eventId) : null;
    return `<div class="day-row"><span class="chip cat-${e.cat} ${e.pending ? "pending" : ""}"><b>${esc(e.title)}</b> ${esc(e.sub)}</span>
      ${l && canApprove() && canDecide(l) ? `<button class="btn btn-secondary btn-sm" data-dec="${l.id}">${l.status === "submitted" ? "승인 처리" : "변경"}</button>` : ""}
      ${l && l.reason && (canManage() || l.employeeId === state.role?.employeeId) ? `<span class="sub">${esc(l.reason)}</span>` : ""}
      ${ev && canEditEvent(ev) ? `<button class="btn btn-secondary btn-sm" data-ev="${ev.id}">수정</button>` : ""}
      ${e.builtin ? `<span class="sub">공휴일(참고용)</span>` : ""}</div>`;
  }).join("") : `<div class="empty" style="padding:16px">등록된 일정이 없습니다.</div>`;
  $("dayList").querySelectorAll("[data-dec]").forEach((b) => b.addEventListener("click", () => { $("dlgDay").close(); openDecision(b.dataset.dec); }));
  $("dayList").querySelectorAll("[data-ev]").forEach((b) => b.addEventListener("click", () => { $("dlgDay").close(); openEvent(state.events.find((x) => x.id === b.dataset.ev)); }));
  $("btnDayLeave").textContent = canManage() ? "휴가 등록" : "휴가 신청";
  $("btnDayLeave").classList.toggle("hidden", !(state.me || canManage()));
  $("btnDayEvent").classList.toggle("hidden", !canManage());
  $("dlgDay").showModal();
}
$("btnDayClose").onclick = () => $("dlgDay").close();
$("btnDayLeave").onclick = () => { $("dlgDay").close(); openLeaveDialog({ date: dayOpen }); };
$("btnDayEvent").onclick = () => { $("dlgDay").close(); openEvent(null, dayOpen); };

// ---------- 일정 추가/수정 ----------
const canEditEvent = (ev) => isHR() || (isAdmin() && (ev.orgIds || []).length === 1 && ev.orgIds[0] === state.role.orgId);
let editingEv = null;
function openEvent(ev, date = "") {
  if (!canManage()) return;
  editingEv = ev;
  $("evTitle").value = ev?.title || ""; $("evKind").value = ev?.kind || "event";
  $("evStart").value = ev?.startDate || date || today(); $("evEnd").value = ev?.endDate || ev?.startDate || date || today();
  $("evNote").value = ev?.note || "";
  const sel = isAdmin() ? [state.role.orgId] : (ev?.orgIds || []);
  renderOrgChecks($("evOrgs"), { selected: sel, disabled: isAdmin(), onlyActive: true });
  $("evOrgHelp").textContent = isAdmin() ? "지점 관리자는 소속 지점 일정만 등록할 수 있습니다." : "아무것도 선택하지 않으면 전체 지점에 표시됩니다.";
  $("btnEvDelete").classList.toggle("hidden", !ev); $("evErr").textContent = ""; $("dlgEvent").showModal();
}
$("btnEventNew").onclick = () => openEvent(null);
$("btnEvCancel").onclick = () => $("dlgEvent").close();
$("btnEvSave").onclick = async () => {
  const title = $("evTitle").value.trim(), start = $("evStart").value, end = $("evEnd").value || start;
  const err = (m) => { $("evErr").textContent = m; };
  if (!title) return err("제목을 입력하세요."); if (title.length > 60) return err("제목은 60자까지입니다.");
  if (!isYmd(start) || !isYmd(end) || end < start) return err("날짜를 확인하세요.");
  const orgIds = isAdmin() ? [state.role.orgId] : readOrgChecks($("evOrgs"));
  const data = { title, kind: $("evKind").value, startDate: start, endDate: end, note: $("evNote").value.trim().slice(0, 500), orgIds, updatedAt: serverTimestamp() };
  try {
    if (editingEv) await updateDoc(doc(db, "calendarEvents", editingEv.id), data);
    else await addDoc(collection(db, "calendarEvents"), { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "" });
    audit(editingEv ? "event_update" : "event_create", { detail: `${title} ${start}~${end}` });
    $("dlgEvent").close(); toast("저장했습니다"); await loadEvents(); renderCalendar();
  } catch (e) { console.error(e); err(errMsg(e)); }
};
$("btnEvDelete").onclick = async () => {
  if (!editingEv || !confirm(`‘${editingEv.title}’ 일정을 삭제할까요?`)) return;
  try { await deleteDoc(doc(db, "calendarEvents", editingEv.id)); audit("event_delete", { detail: editingEv.title }); $("dlgEvent").close(); toast("삭제했습니다"); await loadEvents(); renderCalendar(); }
  catch (e) { console.error(e); $("evErr").textContent = errMsg(e); }
};

// ---------- 월 이동 ----------
function move(n) { cal.m += n; if (cal.m < 1) { cal.m = 12; cal.y--; } if (cal.m > 12) { cal.m = 1; cal.y++; } renderCalendar(); }
$("calPrev").onclick = () => move(-1); $("calNext").onclick = () => move(1);
$("calToday").onclick = () => { cal.y = 0; renderCalendar(); };
$("calOrg").addEventListener("change", (e) => { cal.org = e.target.value; renderCalendar(); });
$("btnCalLeave").onclick = () => openLeaveDialog();
