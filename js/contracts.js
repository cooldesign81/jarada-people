// 직원 상세의 ‘계약서·동의서’ — 근로계약서 · 개인정보 수집·이용 동의서 · 서약서를 온라인으로 작성·저장하고 인쇄(PDF)한다.
// 저장: employees/{사번}/laborContracts (급여가 들어 있어 ‘급여 정보’ 권한자만) · employees/{사번}/contracts (대표이사·원장 등 직원 정보 관리자)
// 칸은 노랑(직원마다 입력)·주황(기본값이 있는 옵션) 두 묶음으로 나뉜다 — 정의와 문구는 contract-docs.js
import { db, auth } from "./firebase.js";
import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, can, canManage, esc, toast, errMsg, audit, tsMillis } from "./core.js";
import { today } from "./dates.js";
import { DOC_TYPES, FIELDS, defaultsFor, buildDocHtml, missingRequired, cleanValues } from "./contract-docs.js";
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

function draw() {
  const el = cur.el, types = allowedTypes();
  el.innerHTML = `<div class="row-actions" style="margin-bottom:10px">${types.map((t) => `<button class="btn btn-secondary btn-sm" data-new="${t}" type="button">+ ${esc(DOC_TYPES[t].title)} 작성</button>`).join("")}</div>
    ${cur.list.length ? `<div class="tbl-wrap"><table class="tbl rec-tbl"><thead><tr><th>종류</th><th>이름·작성일</th><th>저장</th><th></th></tr></thead><tbody>${cur.list.map((c) => `<tr>
      <td class="nowrap"><span class="badge s-active">${esc(DOC_TYPES[c.type]?.title || c.type)}</span></td>
      <td>${esc(c.data?.name || "")} <span class="sub">${esc(c.data?.signDate || "")}</span></td><td class="sub">${esc(fmtTs(c.updatedAt || c.createdAt))}${c.createdByName ? " · " + esc(c.createdByName) : ""}</td>
      <td class="nowrap"><button class="btn btn-primary btn-sm" data-open="${esc(c.id)}" type="button">열기·인쇄</button> <button class="btn btn-secondary btn-sm" data-edit="${esc(c.id)}" type="button">수정</button> <button class="btn btn-danger btn-sm" data-del="${esc(c.id)}" type="button">삭제</button></td></tr>`).join("")}</tbody></table></div>`
      : `<div class="msg">아직 작성한 계약서·동의서가 없습니다.</div>`}`;
  el.querySelectorAll("[data-new]").forEach((b) => (b.onclick = () => openForm(b.dataset.new, null)));
  el.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => { const c = cur.list.find((x) => x.id === b.dataset.edit); if (c) openForm(c.type, c); }));
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => { const c = cur.list.find((x) => x.id === b.dataset.open); if (c) openDoc(c.type, c.data, c.id); }));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => removeDoc(b.dataset.del)));
}

export function openDoc(type, data, id = "") {
  const w = window.open("", "_blank");
  if (!w) return toast("팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.", true);
  w.document.write(buildDocHtml(type, data)); w.document.close();
  audit("contract_open", { targetEmployeeId: cur.emp?.id, detail: `${DOC_TYPES[type].title}${id ? "" : " (미저장)"}` });
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
      await updateDoc(doc(db, "employees", cur.emp.id, DOC_TYPES[type].coll, cur.editing.id), { title, data: values, updatedAt: now });
    } else {
      await addDoc(collOf(cur.emp.id, type), { type, title, data: values, createdAt: now, updatedAt: now, createdBy: auth.currentUser?.uid || "", createdByName: state.me?.name || auth.currentUser?.email || "" });
    }
    audit("contract_save", { targetEmployeeId: cur.emp.id, detail: `${DOC_TYPES[type].title}${cur.editing ? " 수정" : " 작성"}` });
    $("dlgContractDoc").close(); toast("저장했습니다");
    if (openAfter) openDoc(type, values);
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
