// 직원 상세의 인사 기록: 발령·변경 이력, 자격증, 교육·학회 이수, 면담·평가, 증명서 발급 이력, 급여 변경 이력
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, can as cap, isSuper, isHR, isAdmin, isMgr, esc, toast, errMsg, orgNames, audit, tsMillis } from "./core.js";
import { corpName } from "./company.js";
import { isYmd, today, diffDays, fmtKo } from "./dates.js";

const isEdu = () => ["super", "hr", "edu"].includes(state.role?.level);
const me = () => state.me?.name || auth.currentUser?.email || "";

const ASSIGN_TYPES = [["transfer", "지점 이동"], ["position", "직책 변경"], ["level", "권한 변경"], ["status", "재직 상태 변경"], ["other", "기타"]];
const ENR_KINDS = [["training", "보수·직무교육"], ["conference", "학회"], ["other", "기타"]];
const ENR_STATUS = { draft: "작성 중", submitted: "제출", approved: "확정" };
const REV_KINDS = [["interview", "면담"], ["evaluation", "평가"], ["other", "기타"]];
const REV_VIS = [["shared", "직원에게 공개"], ["manager", "관리자 전용"], ["hr", "본사 전용"]];
const label = (list, v) => list.find((x) => x[0] === v)?.[1] || v;

// 종류별 입력 항목 정의
const DEFS = {
  assignments: { title: "발령·변경 기록", fields: [
    { k: "type", l: "종류", t: "select", o: ASSIGN_TYPES }, { k: "date", l: "적용일", t: "date", req: 1 },
    { k: "from", l: "변경 전", t: "text", max: 100 }, { k: "to", l: "변경 후", t: "text", max: 100 }, { k: "note", l: "메모", t: "textarea", max: 500, full: 1 }] },
  certs: { title: "자격증", fields: [
    { k: "name", l: "자격증 이름", t: "text", req: 1, max: 60 }, { k: "number", l: "자격 번호", t: "text", max: 60 },
    { k: "issuer", l: "발급 기관", t: "text", max: 60 }, { k: "issuedDate", l: "취득일", t: "date" }, { k: "expiresDate", l: "만료일 (있으면)", t: "date" },
    { k: "note", l: "메모", t: "textarea", max: 300, full: 1 }] },
  enrollments: { title: "교육·학회 이수", fields: [
    { k: "title", l: "교육·학회 이름", t: "text", req: 1, max: 100, full: 1 }, { k: "kind", l: "구분", t: "select", o: ENR_KINDS },
    { k: "date", l: "일자", t: "date", req: 1 }, { k: "hours", l: "시간", t: "number", min: 0, max: 1000 },
    { k: "report", l: "보고서·적용점", t: "textarea", max: 3000, full: 1 }] },
  reviews: { title: "면담·평가 기록", fields: [
    { k: "kind", l: "구분", t: "select", o: REV_KINDS }, { k: "date", l: "일자", t: "date", req: 1 },
    { k: "title", l: "제목", t: "text", req: 1, max: 100, full: 1 }, { k: "content", l: "내용", t: "textarea", max: 5000, full: 1 },
    { k: "score", l: "점수 (0~100, 선택)", t: "number", min: 0, max: 100 }, { k: "visibility", l: "공개 범위", t: "select", o: REV_VIS }] },
};

const S = { empId: "", emp: null, data: {}, token: 0, editing: null, sub: "" };

// ---------- 권한 ----------
const can = {
  addAssign: () => isHR() || isAdmin(), editAssign: () => isHR(), delAssign: () => isSuper(),
  writeCert: () => isEdu() || isAdmin(),
  addEnr: () => S.emp.id === state.role.employeeId || isEdu() || isAdmin(),
  editEnr: (r) => isEdu() || (S.emp.id === state.role.employeeId && r.status !== "approved"),
  delEnr: (r) => isEdu() || (S.emp.id === state.role.employeeId && r.status === "draft"),
  addRev: () => isHR() || isMgr(),
  editRev: (r) => isHR() || (isMgr() && r.visibility !== "hr"),
  delRev: (r) => isHR() || (isMgr() && r.createdBy === auth.currentUser?.uid),
};

async function load(sub, q) {
  try { return (await getDocs(q || collection(db, "employees", S.empId, sub))).docs.map((d) => ({ id: d.id, ...d.data() })); }
  catch (e) { console.warn("기록 불러오기 실패", sub, e.code || e); return []; }
}
const byDate = (k) => (a, b) => String(b[k] || "").localeCompare(String(a[k] || ""));

export async function mountRecords(root, emp) {
  const token = ++S.token;
  Object.assign(S, { empId: emp.id, emp });
  const self = emp.id === state.role?.employeeId;
  const col = (s) => collection(db, "employees", emp.id, s);
  const revQ = isHR() ? null : (isMgr() ? query(col("reviews"), where("visibility", "in", ["shared", "manager"])) : query(col("reviews"), where("visibility", "==", "shared")));
  const [assignments, certs, enrollments, reviews, certIssues, compHistory] = await Promise.all([
    load("assignments"), load("certs"), load("enrollments"), load("reviews", revQ),
    (isHR() || isAdmin()) ? load("certIssues") : [], cap("comp") ? load("compHistory") : [],
  ]);
  if (token !== S.token) return;
  S.data = { assignments: assignments.sort(byDate("date")), certs: certs.sort(byDate("expiresDate")), enrollments: enrollments.sort(byDate("date")),
    reviews: reviews.sort(byDate("date")), certIssues: certIssues.sort(byDate("createdAt")), compHistory: compHistory.sort((a, b) => tsMillis(b.at) - tsMillis(a.at)) };
  S.root = root; draw();
  return S.data;
}
export function getRecords() { return S.data; }

// ---------- 그리기 ----------
const head = (t, btn = "") => `<div class="card-head-inline"><h3 class="sec-title" style="margin:0;border:0;padding:0">${t}</h3>${btn}</div>`;
const addBtn = (sub, show) => (show ? `<button class="btn btn-secondary btn-sm" data-add="${sub}">+ 추가</button>` : "");
const none = (t) => `<div class="msg">${t}</div>`;
function certState(c) {
  if (!isYmd(c.expiresDate)) return "";
  const d = diffDays(today(), c.expiresDate);
  return d < 0 ? `<span class="badge s-resigned" style="background:#FDECEE;color:#D1182A">만료됨</span>` : d <= 60 ? `<span class="badge s-leave">${d}일 후 만료</span>` : "";
}
function draw() {
  const D = S.data, root = S.root; if (!root) return;
  const parts = [];
  parts.push(`<div class="card">${head("발령·변경 이력", addBtn("assignments", can.addAssign()))}${D.assignments.length ? `<table class="tbl rec-tbl"><tbody>${D.assignments.map((r) => `<tr>
      <td class="sub nowrap">${esc(fmtKo(r.date))}</td><td class="strong">${esc(label(ASSIGN_TYPES, r.type))}</td><td>${esc(r.from || "")}${r.from || r.to ? " → " : ""}${esc(r.to || "")}</td>
      <td class="sub">${esc(r.note || "")}</td><td class="sub">${esc(r.createdByName || "")}</td>
      <td class="nowrap">${can.editAssign() ? `<button class="btn btn-secondary btn-sm" data-edit="assignments:${r.id}">수정</button>` : ""}${can.delAssign() ? ` <button class="btn btn-danger btn-sm" data-del="assignments:${r.id}">삭제</button>` : ""}</td></tr>`).join("")}</tbody></table>` : none("기록이 없습니다.")}
    ${can.addAssign() ? `<div class="help" style="margin-top:8px">기본 정보 수정에서 지점·직책·권한·상태를 바꾸면 자동으로 기록됩니다.</div>` : ""}</div>`);
  parts.push(`<div class="card">${head("자격증", addBtn("certs", can.writeCert()))}${D.certs.length ? `<table class="tbl rec-tbl"><tbody>${D.certs.map((r) => `<tr>
      <td class="strong">${esc(r.name)}</td><td class="sub">${esc(r.number || "")}</td><td class="sub">${esc(r.issuer || "")}</td><td class="sub nowrap">${esc(r.issuedDate || "")}${r.expiresDate ? " ~ " + esc(r.expiresDate) : ""}</td>
      <td>${certState(r)}</td><td class="nowrap">${can.writeCert() ? `<button class="btn btn-secondary btn-sm" data-edit="certs:${r.id}">수정</button> <button class="btn btn-danger btn-sm" data-del="certs:${r.id}">삭제</button>` : ""}</td></tr>`).join("")}</tbody></table>` : none("등록된 자격증이 없습니다.")}</div>`);
  parts.push(`<div class="card">${head("교육·학회 이수", addBtn("enrollments", can.addEnr()))}${D.enrollments.length ? `<table class="tbl rec-tbl"><tbody>${D.enrollments.map((r) => `<tr>
      <td class="sub nowrap">${esc(fmtKo(r.date))}</td><td class="strong" style="white-space:normal">${esc(r.title)}<div class="sub">${esc(label(ENR_KINDS, r.kind))}${r.hours ? ` · ${r.hours}시간` : ""}</div></td>
      <td><span class="badge ${r.status === "approved" ? "s-active" : r.status === "submitted" ? "s-leave" : "off"}">${ENR_STATUS[r.status] || r.status}</span></td>
      <td class="nowrap">${isEdu() && r.status !== "approved" ? `<button class="btn btn-primary btn-sm" data-approve="${r.id}">확정</button> ` : ""}${can.editEnr(r) ? `<button class="btn btn-secondary btn-sm" data-edit="enrollments:${r.id}">${r.status === "approved" ? "보기" : "수정"}</button>` : ""}${can.delEnr(r) ? ` <button class="btn btn-danger btn-sm" data-del="enrollments:${r.id}">삭제</button>` : ""}</td></tr>`).join("")}</tbody></table>` : none("이수 기록이 없습니다.")}</div>`);
  if (D.reviews.length || can.addRev() || state.role?.employeeId === S.emp.id)
    parts.push(`<div class="card">${head("면담·평가 기록", addBtn("reviews", can.addRev()))}${D.reviews.length ? `<table class="tbl rec-tbl"><tbody>${D.reviews.map((r) => `<tr>
      <td class="sub nowrap">${esc(fmtKo(r.date))}</td><td class="strong" style="white-space:normal">${esc(r.title)}<div class="sub" style="white-space:pre-wrap">${esc(r.content || "")}</div></td>
      <td class="sub nowrap">${esc(label(REV_KINDS, r.kind))}${r.score !== undefined && r.score !== "" && r.score !== null ? ` · ${r.score}점` : ""}</td><td><span class="badge off">${esc(label(REV_VIS, r.visibility))}</span></td>
      <td class="sub">${esc(r.createdByName || "")}</td><td class="nowrap">${can.editRev(r) ? `<button class="btn btn-secondary btn-sm" data-edit="reviews:${r.id}">수정</button>` : ""}${can.delRev(r) ? ` <button class="btn btn-danger btn-sm" data-del="reviews:${r.id}">삭제</button>` : ""}</td></tr>`).join("")}</tbody></table>` : none("기록이 없습니다.")}</div>`);
  if (isHR() || isAdmin()) parts.push(`<div class="card">${head("증명서 발급 이력")}${D.certIssues.length ? `<table class="tbl rec-tbl"><tbody>${D.certIssues.map((r) => `<tr>
      <td class="mono">${esc(r.no)}</td><td class="strong">${r.type === "career" ? "경력증명서" : "재직증명서"}</td><td class="sub">${esc(r.issuedDate)}</td><td class="sub">${esc(r.purpose || "")}</td><td class="sub">${esc(r.companyName || "")}</td>
      <td class="sub">${esc(r.issuedByName || "")}</td><td><button class="btn btn-secondary btn-sm" data-reprint="${r.id}">다시 인쇄</button></td></tr>`).join("")}</tbody></table>` : none("발급한 증명서가 없습니다.")}</div>`);
  root.innerHTML = parts.join("");
  root.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => openRec(b.dataset.add, null)));
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => { const [s, id] = b.dataset.edit.split(":"); openRec(s, S.data[s].find((x) => x.id === id)); }));
  root.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => { const [s, id] = b.dataset.del.split(":"); removeRec(s, S.data[s].find((x) => x.id === id)); }));
  root.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => approveEnr(S.data.enrollments.find((x) => x.id === b.dataset.approve))));
  root.querySelectorAll("[data-reprint]").forEach((b) => b.addEventListener("click", () => ctx.reprint?.(S.data.certIssues.find((x) => x.id === b.dataset.reprint))));
}
let ctx = {};
export function initRecords(c) { ctx = { ...ctx, ...c }; }

// ---------- 추가/수정 ----------
function fieldHtml(f, v) {
  const id = "rf_" + f.k, val = v ?? "";
  const input = f.t === "select" ? `<select id="${id}">${f.o.map(([k, l]) => `<option value="${k}" ${val === k ? "selected" : ""}>${l}</option>`).join("")}</select>`
    : f.t === "textarea" ? `<textarea id="${id}" maxlength="${f.max || 500}" rows="3">${esc(val)}</textarea>`
    : `<input class="input" id="${id}" type="${f.t}" ${f.max && f.t === "text" ? `maxlength="${f.max}"` : ""} ${f.t === "number" ? `min="${f.min ?? 0}" max="${f.max ?? 1000}" step="0.5"` : ""} value="${esc(val)}">`;
  return `<div class="field ${f.full ? "full" : ""}"><label for="${id}">${f.l}${f.req ? '<span class="req">*</span>' : ""}</label>${input}</div>`;
}
function openRec(sub, rec) {
  S.sub = sub; S.editing = rec;
  const def = DEFS[sub];
  const defaults = { date: today(), type: "other", kind: sub === "reviews" ? "interview" : "training", visibility: "shared", hours: "" };
  $("recTitle").textContent = `${def.title} ${rec ? "수정" : "추가"}`;
  $("recFields").innerHTML = def.fields.map((f) => fieldHtml(f, rec ? rec[f.k] : defaults[f.k])).join("");
  const readonly = sub === "enrollments" && rec?.status === "approved" && !isEdu();
  $("recFields").querySelectorAll("input,select,textarea").forEach((el) => (el.disabled = readonly));
  $("btnRecSave").classList.toggle("hidden", readonly);
  $("recErr").textContent = ""; $("dlgRec").showModal();
}
$("btnRecCancel").onclick = () => $("dlgRec").close();
$("btnRecSave").onclick = async () => {
  const sub = S.sub, def = DEFS[sub], data = {};
  for (const f of def.fields) {
    let v = $("rf_" + f.k).value.trim();
    if (f.req && !v) return ($("recErr").textContent = `${f.l}을(를) 입력하세요.`);
    if (f.t === "date" && v && !isYmd(v)) return ($("recErr").textContent = `${f.l} 형식이 올바르지 않습니다.`);
    if (f.t === "number") { if (v === "") { v = f.k === "score" ? null : 0; } else { v = Number(v); if (!(v >= (f.min ?? 0) && v <= (f.max ?? 1000))) return ($("recErr").textContent = `${f.l} 범위를 확인하세요.`); } }
    if (v !== null) data[f.k] = v;
  }
  const emp = S.emp, now = serverTimestamp();
  try {
    if (S.editing) {
      const patch = { ...data, updatedAt: now };
      if (sub === "enrollments" && !isEdu()) patch.status = "draft";
      await updateDoc(doc(db, "employees", emp.id, sub, S.editing.id), patch);
    } else {
      const base = { ...data, orgId: emp.orgId, createdAt: now, updatedAt: now, createdBy: auth.currentUser?.uid || "", createdByName: me() };
      if (sub === "enrollments") base.status = "draft";
      await addDoc(collection(db, "employees", emp.id, sub), base);
    }
    audit("record_add", { targetEmployeeId: emp.id, detail: `${def.title}${data.name || data.title ? ": " + (data.name || data.title) : ""}` });
    $("dlgRec").close(); toast("저장했습니다"); await refresh();
  } catch (e) { console.error(e); $("recErr").textContent = errMsg(e); }
};
async function removeRec(sub, rec) {
  if (!rec || !confirm("이 기록을 삭제할까요?")) return;
  try { await deleteDoc(doc(db, "employees", S.emp.id, sub, rec.id)); audit("record_delete", { targetEmployeeId: S.emp.id, detail: DEFS[sub].title }); toast("삭제했습니다"); await refresh(); }
  catch (e) { console.error(e); toast(errMsg(e), true); }
}
async function approveEnr(rec) {
  try { await updateDoc(doc(db, "employees", S.emp.id, "enrollments", rec.id), { status: "approved", approvedBy: me(), updatedAt: serverTimestamp() }); toast("확정했습니다"); await refresh(); }
  catch (e) { console.error(e); toast(errMsg(e), true); }
}
async function refresh() { const root = S.root; await mountRecords(root, S.emp); ctx.afterChange?.(); }

// ---------- 자동 기록 (직원 정보가 바뀔 때) ----------
export async function addAssignments(emp, changes) {
  const col = collection(db, "employees", emp.id, "assignments");
  for (const c of changes) {
    try {
      await addDoc(col, { type: c.type, date: today(), from: String(c.from || "").slice(0, 100), to: String(c.to || "").slice(0, 100), note: c.note || "자동 기록",
        orgId: emp.orgId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: auth.currentUser?.uid || "", createdByName: me() });
    } catch (e) { console.warn("발령 기록 실패", e.code || e); }
  }
}
export function diffEmployee(before, after, statusMap, levelMap) {
  const out = [];
  if (JSON.stringify(before.orgIds) !== JSON.stringify(after.orgIds)) out.push({ type: "transfer", from: orgNames(before.orgIds), to: orgNames(after.orgIds) });
  if ((before.position || "") !== (after.position || "")) out.push({ type: "position", from: before.position || "—", to: after.position || "—" });
  if (before.level !== after.level) out.push({ type: "level", from: levelMap[before.level] || before.level, to: levelMap[after.level] || after.level });
  if ((before.corp || "") !== (after.corp || "")) out.push({ type: "other", from: corpName(before.corp) || "—", to: corpName(after.corp) || "—", note: "소속 법인 변경" });
  if (before.status !== after.status) out.push({ type: "status", from: statusMap[before.status] || before.status, to: statusMap[after.status] || after.status });
  return out;
}

// ---------- 급여 변경 이력 (급여 카드에서 사용) ----------
export function compHistoryHtml() {
  const list = S.data.compHistory || [];
  return `<div class="field"><label>급여 변경 이력</label>${list.length ? `<table class="tbl rec-tbl"><tbody>${list.map((h) => `<tr><td class="sub nowrap">${esc(h.date)}</td>
      <td style="white-space:normal">${(h.changes || []).map((c) => `${esc(c.label)}: ${esc(c.from || "—")} → ${esc(c.to || "—")}`).join("<br>")}</td><td class="sub">${esc(h.byName || "")}</td></tr>`).join("")}</tbody></table>` : `<div class="msg">변경 이력이 없습니다.</div>`}</div>`;
}
export async function addCompHistory(empId, changes) {
  if (!changes.length) return;
  try { await addDoc(collection(db, "employees", empId, "compHistory"), { date: today(), changes, by: auth.currentUser?.uid || "", byName: me(), at: serverTimestamp() }); }
  catch (e) { console.warn("급여 이력 기록 실패", e.code || e); }
}
