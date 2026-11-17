// 직원 상세의 ‘계약서·동의서’ — 근로계약서 · 개인정보 수집·이용 동의서 · 서약서를 온라인으로 작성·저장하고 인쇄(PDF)한다.
// 관리자가 ‘서명 요청’을 보내면 직원이 ‘내 서류’에서 내용을 확인하고 손으로 서명(전자서명)한다. 서명이 끝난 문서는 고칠 수 없다.
// 저장: employees/{사번}/laborContracts (급여가 들어 있어 ‘급여 정보’ 권한자만) · employees/{사번}/contracts (대표이사·원장 등 직원 정보 관리자)
// 칸은 노랑(직원마다 입력)·주황(기본값이 있는 옵션) 두 묶음으로 나뉜다 — 정의와 문구는 contract-docs.js
import { db, auth } from "./firebase.js";
import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp, query, where } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, can, canManage, isSuper, esc, toast, errMsg, audit, tsMillis } from "./core.js";
import { today } from "./dates.js";
import { DOC_TYPES, FIELDS, defaultsFor, buildDocHtml, missingRequired, cleanValues, signAnswerFields, signedValues, signMeta } from "./contract-docs.js";
import { fixedItems } from "./payroll-calc.js";

const collOf = (empId, type) => collection(db, "employees", empId, DOC_TYPES[type].coll);
const allowedTypes = () => Object.keys(DOC_TYPES).filter((t) => (DOC_TYPES[t].needs ? can(DOC_TYPES[t].needs) : canManage()));
const fmtTs = (t) => { const ms = tsMillis(t); if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };

let cur = { emp: null, pi: {}, comp: {}, el: null, list: [], editing: null, type: "" };

export async function mountContracts(el, ctx) {
  if (!el) return;
  cur = { ...cur, ...ctx, el };
  const types = allowedTypes();
  if (!types.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="msg">불러오는 중…</div>`;
  const colls = [...new Set(types.map((t) => DOC_TYPES[t].coll))];
  const list = [];
  for (const c of colls) {
    try { (await getDocs(collection(db, "employees", ctx.emp.id, c))).docs.forEach((d) => list.push({ id: d.id, ...d.data() })); }
    catch (e) { console.warn("계약서 불러오기 실패", c, e.code || e); }
  }
  list.sort((a, b) => tsMillis(b.updatedAt || b.createdAt) - tsMillis(a.updatedAt || a.createdAt));
  cur.list = list;
  draw();
}

const stOf = (c) => c.status || "draft";
const STATUS = { draft: ["작성중", "s-leave"], sent: ["서명 대기", "o-hq"], signed: ["서명 완료", "s-active"] };
const statusBadge = (c) => `<span class="badge ${STATUS[stOf(c)][1]}">${STATUS[stOf(c)][0]}</span>`;

function draw() {
  const el = cur.el, types = allowedTypes();
  el.innerHTML = `<div class="row-actions" style="margin-bottom:10px">${types.map((t) => `<button class="btn btn-secondary btn-sm" data-new="${t}" type="button">+ ${esc(DOC_TYPES[t].title)} 작성</button>`).join("")}</div>
    <div class="help" style="margin:-4px 0 10px">작성한 문서는 <b>‘서명 요청’</b>을 보내면 직원이 <b>내 서류</b>에서 내용을 보고 직접 서명합니다 (직원이 구글 계정으로 로그인해 있어야 합니다). 서명이 끝나면 고치거나 지울 수 없습니다.</div>
    ${cur.list.length ? `<div class="tbl-wrap"><table class="tbl rec-tbl"><thead><tr><th>종류</th><th>이름·작성일</th><th>상태</th><th>저장</th><th></th></tr></thead><tbody>${cur.list.map((c) => {
      const st = stOf(c);
      return `<tr>
      <td class="nowrap"><span class="badge s-active">${esc(DOC_TYPES[c.type]?.title || c.type)}</span></td>
      <td>${esc(c.data?.name || "")} <span class="sub">${esc(c.data?.signDate || "")}</span></td>
      <td class="nowrap">${statusBadge(c)}${st === "signed" ? ` <span class="sub">${esc(fmtTs(c.signedAt))}</span>` : st === "sent" ? ` <span class="sub">${esc(fmtTs(c.sentAt))} 요청</span>` : ""}</td>
      <td class="sub">${esc(fmtTs(c.updatedAt || c.createdAt))}${c.createdByName ? " · " + esc(c.createdByName) : ""}</td>
      <td class="nowrap"><button class="btn btn-primary btn-sm" data-open="${esc(c.id)}" type="button">열기·인쇄</button>
        ${st === "draft" ? `<button class="btn btn-secondary btn-sm" data-send="${esc(c.id)}" type="button">서명 요청</button>` : ""}${st === "sent" ? `<button class="btn btn-secondary btn-sm" data-unsend="${esc(c.id)}" type="button">요청 취소</button>` : ""}
        ${st !== "signed" ? `<button class="btn btn-secondary btn-sm" data-edit="${esc(c.id)}" type="button">수정</button>` : ""}
        ${st !== "signed" || isSuper() ? `<button class="btn btn-danger btn-sm" data-del="${esc(c.id)}" type="button">삭제</button>` : ""}</td></tr>`; }).join("")}</tbody></table></div>`
      : `<div class="msg">아직 작성한 계약서·동의서가 없습니다.</div>`}`;
  const find = (id) => cur.list.find((x) => x.id === id);
  el.querySelectorAll("[data-new]").forEach((b) => (b.onclick = () => openForm(b.dataset.new, null)));
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { const c = find(b.dataset.edit); if (!c) return; if (stOf(c) === "sent" && !confirm("수정하면 보낸 서명 요청이 취소되고 ‘작성중’으로 돌아갑니다. 수정할까요?")) return; openForm(c.type, c); }));
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const c = find(b.dataset.open); if (c) openDoc(c); }));
  el.querySelectorAll("[data-send]").forEach((b) => (b.onclick = () => setStatus(find(b.dataset.send), "sent")));
  el.querySelectorAll("[data-unsend]").forEach((b) => (b.onclick = () => setStatus(find(b.dataset.unsend), "draft")));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => removeDoc(b.dataset.del)));
}

// 서명 요청 보내기 / 취소
async function setStatus(c, status) {
  if (!c) return;
  const send = status === "sent";
  if (!confirm(send ? `‘${DOC_TYPES[c.type].title}’ 서명 요청을 ${c.data?.name || "직원"}님에게 보낼까요?\n직원이 내 서류에서 내용을 확인하고 서명합니다.` : "서명 요청을 취소할까요? 직원 화면에서 사라집니다.")) return;
  try {
    await updateDoc(doc(db, "employees", cur.emp.id, DOC_TYPES[c.type].coll, c.id), send ? { status: "sent", sentAt: serverTimestamp(), updatedAt: serverTimestamp() } : { status: "draft", updatedAt: serverTimestamp() });
    audit(send ? "contract_send" : "contract_unsend", { targetEmployeeId: cur.emp.id, detail: DOC_TYPES[c.type].title });
    toast(send ? "서명 요청을 보냈습니다" : "서명 요청을 취소했습니다");
    await mountContracts(cur.el, { emp: cur.emp, pi: cur.pi, comp: cur.comp });
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

// 열기·인쇄. c = 저장된 문서(또는 저장 직전의 { type, data }). 서명이 있으면 서명 이미지와 직원의 답까지 넣어 보여 준다
export function openDoc(c) {
  const w = window.open("", "_blank");
  if (!w) return toast("팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.", true);
  w.document.write(buildDocHtml(c.type, signedValues(c), { sign: signMeta(c, tsMillis(c.signedAt)) })); w.document.close();
  audit("contract_open", { targetEmployeeId: cur.emp?.id, detail: `${DOC_TYPES[c.type].title}${c.id ? "" : " (미저장)"}` });
}

// ---------- 작성·수정 창 ----------
const inputHtml = (f, val) => {
  const id = "cdf_" + f.key, v = val ?? "";
  if (f.type === "check") return `<label class="check ${f.wide ? "full" : ""}"><input type="checkbox" id="${id}" ${v === true ? "checked" : ""}> ${esc(f.label)}</label>`;
  const body = f.type === "textarea" ? `<textarea class="input" id="${id}" rows="3" maxlength="2000">${esc(v)}</textarea>`
    : f.type === "select" ? `<select id="${id}">${f.options.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`
    : `<input class="input" id="${id}" type="${f.type === "number" ? "number" : f.type || "text"}" maxlength="300" value="${esc(v)}">`;
  return `<div class="field ${f.wide ? "full" : ""}"><label for="${id}">${esc(f.label)}${f.req ? '<span class="req">*</span>' : ""}</label>${body}</div>`;
};
const readForm = (type) => Object.fromEntries(FIELDS[type].map((f) => { const e = $("cdf_" + f.key); return [f.key, f.type === "check" ? !!e?.checked : (e?.value ?? "")]; }));

function openForm(type, existing) {
  cur.type = type; cur.editing = existing;
  const base = defaultsFor(type, { emp: cur.emp, pi: cur.pi, today: today(), payTotal: can("comp") ? fixedItems(cur.comp || {}).total : 0 });
  const vals = { ...base, ...(existing?.data || {}) };
  $("cdTitle").textContent = `${DOC_TYPES[type].title} ${existing ? "수정" : "작성"}`;
  $("cdY").innerHTML = FIELDS[type].filter((f) => f.grp === "y").map((f) => inputHtml(f, vals[f.key])).join("");
  $("cdO").innerHTML = FIELDS[type].filter((f) => f.grp === "o").map((f) => inputHtml(f, vals[f.key])).join("");
  $("cdOWrap").classList.toggle("hidden", !FIELDS[type].some((f) => f.grp === "o"));
  $("cdErr").textContent = "";
  $("btnCdCancel").onclick = () => $("dlgContractDoc").close();
  $("btnCdSave").onclick = () => save(false);
  $("btnCdSaveOpen").onclick = () => save(true);
  $("btnCdReset").onclick = () => { FIELDS[type].filter((f) => f.grp === "o").forEach((f) => { const e = $("cdf_" + f.key); if (!e) return; if (f.type === "check") e.checked = base[f.key] === true; else e.value = base[f.key] ?? ""; }); };
  $("dlgContractDoc").showModal();
}

async function save(openAfter) {
  const type = cur.type, values = cleanValues(type, readForm(type));
  const miss = missingRequired(type, values);
  if (miss.length) return ($("cdErr").textContent = `${miss.join(", ")}을(를) 입력하세요.`);
  const title = `${DOC_TYPES[type].title} · ${values.name}`;
  $("btnCdSave").disabled = $("btnCdSaveOpen").disabled = true;
  try {
    const now = serverTimestamp();
    if (cur.editing) {
      await updateDoc(doc(db, "employees", cur.emp.id, DOC_TYPES[type].coll, cur.editing.id), { title, data: values, status: "draft", updatedAt: now });
    } else {
      await addDoc(collOf(cur.emp.id, type), { type, title, data: values, status: "draft", createdAt: now, updatedAt: now, createdBy: auth.currentUser?.uid || "", createdByName: state.me?.name || auth.currentUser?.email || "" });
    }
    audit("contract_save", { targetEmployeeId: cur.emp.id, detail: `${DOC_TYPES[type].title}${cur.editing ? " 수정" : " 작성"}` });
    $("dlgContractDoc").close(); toast("저장했습니다");
    if (openAfter) openDoc({ type, data: values });
    await mountContracts(cur.el, { emp: cur.emp, pi: cur.pi, comp: cur.comp });
  } catch (e) { console.error(e); $("cdErr").textContent = errMsg(e); }
  finally { $("btnCdSave").disabled = $("btnCdSaveOpen").disabled = false; }
}

async function removeDoc(id) {
  const c = cur.list.find((x) => x.id === id); if (!c) return;
  if (!confirm(`${DOC_TYPES[c.type]?.title || "문서"}(${c.data?.name || ""})를 삭제할까요? 되돌릴 수 없습니다.`)) return;
  try {
    await deleteDoc(doc(db, "employees", cur.emp.id, DOC_TYPES[c.type].coll, id));
    audit("contract_delete", { targetEmployeeId: cur.emp.id, detail: DOC_TYPES[c.type].title });
    toast("삭제했습니다"); await mountContracts(cur.el, { emp: cur.emp, pi: cur.pi, comp: cur.comp });
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

// ============================================================
// 직원 본인 화면 (내 서류) — 서명 요청 받은 문서 보기·서명
// ============================================================
const SIGN_STATUSES = ["sent", "signed"];
const emptyList = (empId) => ({ empId, list: [] });
let mine = emptyList("");

// 서명 대기 건수 (내 정보 화면의 알림용). 규칙이 아직 열리지 않았거나 읽을 수 없으면 0
export async function countPendingSign(empId) {
  let n = 0;
  for (const c of [...new Set(Object.values(DOC_TYPES).map((t) => t.coll))]) {
    try { n += (await getDocs(query(collection(db, "employees", empId, c), where("status", "==", "sent")))).size; } catch (e) { /* 권한 없음 = 해당 없음 */ }
  }
  return n;
}

export async function mountMySignatures(el, { empId, emp }) {
  if (!el) return;
  mine = { ...emptyList(empId), emp };
  el.innerHTML = `<div class="msg">불러오는 중…</div>`;
  const list = [];
  for (const coll of [...new Set(Object.values(DOC_TYPES).map((t) => t.coll))]) {
    for (const st of SIGN_STATUSES) {
      try { (await getDocs(query(collection(db, "employees", empId, coll), where("status", "==", st)))).docs.forEach((d) => list.push({ id: d.id, coll, ...d.data() })); }
      catch (e) { console.warn("서명 문서 불러오기 실패", coll, st, e.code || e); }
    }
  }
  list.sort((a, b) => (stOf(a) === "sent" ? 0 : 1) - (stOf(b) === "sent" ? 0 : 1) || tsMillis(b.sentAt || b.signedAt) - tsMillis(a.sentAt || a.signedAt));
  mine.list = list;
  if (!list.length) { el.innerHTML = `<div class="msg">서명할 계약서·동의서가 없습니다.</div>`; return; }
  el.innerHTML = `<div class="tbl-wrap"><table class="tbl rec-tbl"><thead><tr><th>문서</th><th>상태</th><th></th></tr></thead><tbody>${list.map((c) => `<tr>
    <td><b>${esc(DOC_TYPES[c.type]?.title || c.type)}</b> <span class="sub">${esc(c.data?.signDate || "")}</span></td>
    <td class="nowrap">${statusBadge(c)} <span class="sub">${esc(stOf(c) === "signed" ? fmtTs(c.signedAt) : fmtTs(c.sentAt) + " 요청")}</span></td>
    <td class="nowrap">${stOf(c) === "sent" ? `<button class="btn btn-primary btn-sm" data-sign="${esc(c.id)}" type="button">확인하고 서명</button>` : `<button class="btn btn-secondary btn-sm" data-view="${esc(c.id)}" type="button">보기</button>`}</td></tr>`).join("")}</tbody></table></div>`;
  el.querySelectorAll("[data-sign]").forEach((b) => (b.onclick = () => openSign(mine.list.find((x) => x.id === b.dataset.sign), el)));
  el.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => { const c = mine.list.find((x) => x.id === b.dataset.view); if (c) openDoc(c); }));
}

// ---------- 서명 창 ----------
let pad = { drawing: false, ink: false, last: null };
function padPos(cv, e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) }; }
function bindPad() {
  const cv = $("sgPad"), ctx = cv.getContext("2d");
  ctx.lineWidth = 3.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#111";
  const clear = () => { ctx.clearRect(0, 0, cv.width, cv.height); pad = { drawing: false, ink: false, last: null }; };
  clear();
  cv.onpointerdown = (e) => { e.preventDefault(); cv.setPointerCapture?.(e.pointerId); pad.drawing = true; pad.last = padPos(cv, e); ctx.beginPath(); ctx.arc(pad.last.x, pad.last.y, 1.4, 0, 6.3); ctx.fillStyle = "#111"; ctx.fill(); pad.ink = true; };
  cv.onpointermove = (e) => { if (!pad.drawing) return; e.preventDefault(); const p = padPos(cv, e); ctx.beginPath(); ctx.moveTo(pad.last.x, pad.last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); pad.last = p; };
  const end = () => { pad.drawing = false; };
  cv.onpointerup = end; cv.onpointercancel = end; cv.onpointerleave = end;
  $("btnSgClear").onclick = clear;
}

function openSign(c, listEl) {
  if (!c) return;
  const type = c.type, t = DOC_TYPES[type], fields = signAnswerFields(type, c.data || {});
  $("sgTitle").textContent = `${t.title} — 내용 확인 및 서명`;
  $("sgFrame").srcdoc = buildDocHtml(type, signedValues(c), { autoPrint: false });
  $("sgAns").innerHTML = fields.length ? `<h3 class="sec-title" style="margin:12px 0 6px">직접 선택할 항목</h3><div class="grid-fields">${fields.map((f) => f.type === "check"
    ? `<label class="check full"><input type="checkbox" id="sga_${f.key}"> ${esc(f.text || f.label)}<span class="req">*</span></label>`
    : `<div class="field"><label for="sga_${f.key}">${esc(f.label)}<span class="req">*</span></label><select id="sga_${f.key}"><option value="">선택하세요</option>${f.options.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join("")}</select></div>`).join("")}</div>` : "";
  $("sgAgree").checked = false; $("sgErr").textContent = "";
  bindPad();
  $("btnSgCancel").onclick = () => $("dlgSign").close();
  $("btnSgSubmit").onclick = () => submitSign(c, fields, listEl);
  $("dlgSign").showModal();
}

async function submitSign(c, fields, listEl) {
  const err = (m) => ($("sgErr").textContent = m);
  const answers = {};
  for (const f of fields) {
    const e = $("sga_" + f.key);
    if (f.type === "check") { if (!e.checked) return err(`‘${f.text || f.label}’에 체크해 주세요.`); answers[f.key] = true; }
    else { if (!e.value) return err(`${f.label}을(를) 선택해 주세요.`); answers[f.key] = e.value; }
  }
  if (!pad.ink) return err("서명란에 서명해 주세요.");
  if (!$("sgAgree").checked) return err("내용을 모두 읽었고 본인의 서명임을 확인한다는 곳에 체크해 주세요.");
  const signature = $("sgPad").toDataURL("image/png");
  if (signature.length > 110000) return err("서명 이미지가 너무 큽니다. 지우고 다시 간단히 서명해 주세요.");
  $("btnSgSubmit").disabled = true;
  try {
    await updateDoc(doc(db, "employees", mine.empId, c.coll, c.id), { status: "signed", signature, signedAt: serverTimestamp(), signedBy: auth.currentUser?.uid || "", answers });
    audit("contract_sign", { targetEmployeeId: mine.empId, detail: DOC_TYPES[c.type].title });
    $("dlgSign").close(); toast("서명했습니다. 서명한 문서는 ‘보기’에서 다시 볼 수 있습니다.");
    await mountMySignatures(listEl, { empId: mine.empId, emp: mine.emp });
  } catch (e) { console.error(e); err(errMsg(e)); }
  finally { $("btnSgSubmit").disabled = false; }
}
