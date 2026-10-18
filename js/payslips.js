// 급여 명세서·급여 세부내역서 배포
//  · 관리 → 급여 배포 (‘급여 정보’ 권한자): 종류(급여 명세서 / 급여 세부내역서)와 월을 고르고 파일을 여러 개 올린다. 파일 이름의 직원 이름으로 직원을 맞춘다
//  · 내 급여 (직원 본인, 구글 로그인): 자기 명세서를 보고 내려받는다. 열 때마다 ‘급여 열람 비밀번호’를 한 번 더 확인한다. 처음 열면 ‘열람’ 시각이 남는다
//  파일은 Storage hr/{사번}/pay/, 목록·열람 기록은 employees/{사번}/payslips 문서
import { db, auth, storage } from "./firebase.js";
import { collection, doc, getDocs, addDoc, updateDoc, deleteDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { $, state, can, esc, toast, errMsg, audit, tsMillis, orgNames } from "./core.js";
import { today } from "./dates.js";
import { SLIP_TYPES, guessEmployee, isAllowedFile, contentTypeOf } from "./payslip-match.js";
import { requirePayPassword, changePayPassword, getPayLock } from "./paylock.js";

const slipsOf = (empId) => collection(db, "employees", empId, "payslips");
const fmtDT = (t) => { const ms = tsMillis(t); if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const monthLabel = (m) => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;
const byNewest = (a, b) => (b.month || "").localeCompare(a.month || "") || a.type.localeCompare(b.type) || tsMillis(b.createdAt) - tsMillis(a.createdAt);
const typeBadge = (t) => `<span class="badge ${t === "incentive" ? "s-leave" : "s-active"}">${esc(SLIP_TYPES[t] || t)}</span>`;

// ---------- 내 명세서 ----------
export async function loadMyPayslips() {
  state.payslips = [];
  if (state.selfMode || !state.role?.employeeId) return;
  try { state.payslips = (await getDocs(slipsOf(state.role.employeeId))).docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest); }
  catch (e) { console.warn("명세서 불러오기 실패", e.code || e); }
}
export const unseenSlips = () => (state.payslips || []).filter((s) => !s.viewedAt).length;

async function openSlip(s, empId, { mine, download }) {
  try {
    // 본인이 열 때는 매번 비밀번호를 확인한다 (자리를 비운 사이 다른 사람이 보지 못하게). 관리자가 직원 것을 볼 때는 묻지 않는다
    if (mine && !(await requirePayPassword(empId))) return false;
    const url = await getDownloadURL(ref(storage, s.path));
    if (download) { const a = document.createElement("a"); a.href = url; a.download = s.fileName || "명세서"; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
    else if (!window.open(url, "_blank", "noopener")) toast("팝업이 차단됐습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.", true);
    audit("payslip_view", { targetEmployeeId: empId, detail: `${monthLabel(s.month)} ${SLIP_TYPES[s.type] || s.type}${download ? " 다운로드" : ""}` });
    if (mine && !s.viewedAt) { // 처음 연 시각만 기록
      try { await updateDoc(doc(db, "employees", empId, "payslips", s.id), { viewedAt: serverTimestamp() }); s.viewedAt = { seconds: Math.floor(Date.now() / 1000) }; ctx.onSeen?.(); }
      catch (e) { console.warn("열람 기록 실패", e.code || e); }
    }
  } catch (e) { console.error(e); toast("열 수 없습니다: " + errMsg(e), true); return false; }
  return true;
}
let ctx = {};
export function initPayslips(c) { ctx = c; }

export async function renderMyPayslips() {
  const root = $("payslipBody");
  root.innerHTML = `<div class="msg">불러오는 중…</div>`;
  await loadMyPayslips(); ctx.onSeen?.();
  const list = state.payslips;
  let lock = null; try { lock = await getPayLock(state.role.employeeId); } catch {}
  const lockBar = `<div class="notice" style="margin-bottom:12px">🔒 급여 명세서는 <b>열 때마다 ‘급여 열람 비밀번호’를 한 번 더 확인</b>합니다. ${lock ? `<button class="btn btn-secondary btn-sm" id="btnPayPwChange">비밀번호 변경</button>` : `아직 비밀번호를 정하지 않았습니다. <button class="btn btn-primary btn-sm" id="btnPayPwChange">비밀번호 설정</button>`}</div>`;
  if (!list.length) { root.innerHTML = lockBar + `<div class="card"><div class="msg">아직 받은 명세서가 없습니다.</div></div>`; $("btnPayPwChange").onclick = async () => { if (await changePayPassword()) renderMyPayslips(); }; return; }
  const months = [...new Set(list.map((s) => s.month))];
  root.innerHTML = lockBar + months.map((m) => `<div class="card"><h2>${monthLabel(m)}</h2>${list.filter((s) => s.month === m).map((s) => `<div class="slip-row">
      <div>${typeBadge(s.type)} ${!s.viewedAt ? `<span class="badge s-active" data-new>새 명세서</span>` : ""}<div class="sub">${esc(s.fileName || "")}${s.size ? ` · ${(s.size / 1024).toFixed(0)}KB` : ""} · ${esc(fmtDT(s.createdAt))} 배포</div></div>
      <div class="row-actions"><button class="btn btn-primary btn-sm" data-view="${esc(s.id)}">보기</button> <button class="btn btn-secondary btn-sm" data-dl="${esc(s.id)}">다운로드</button></div></div>`).join("")}</div>`).join("") +
    `<p class="sub">본인 계정으로 로그인했을 때만 볼 수 있습니다. 자리를 비울 때는 로그아웃하거나 화면을 잠가 주세요.</p>`;
  $("btnPayPwChange").onclick = async () => { if (await changePayPassword()) renderMyPayslips(); };
  const act = (id, download) => { const s = list.find((x) => x.id === id); openSlip(s, state.role.employeeId, { mine: true, download }).then((ok) => { if (!ok) return; const row = root.querySelector(`[data-view="${id}"]`)?.closest(".slip-row"); row?.querySelector("[data-new]")?.remove(); }); };
  root.querySelectorAll("[data-view]").forEach((b) => (b.onclick = () => act(b.dataset.view, false)));
  root.querySelectorAll("[data-dl]").forEach((b) => (b.onclick = () => act(b.dataset.dl, true)));
}

// ---------- 직원 상세: 이 직원의 명세서 목록 (급여 권한자) ----------
export async function mountEmployeeSlips(el, emp) {
  if (!el) return;
  el.innerHTML = `<div class="msg">불러오는 중…</div>`;
  let list = [];
  try { list = (await getDocs(slipsOf(emp.id))).docs.map((d) => ({ id: d.id, ...d.data() })).sort(byNewest); } catch (e) { console.warn(e.code || e); }
  let lock = null; try { lock = await getPayLock(emp.id); } catch {}
  const lockLine = `<div class="sub" style="margin:0 0 8px">급여 열람 비밀번호: ${lock ? `설정됨 <button class="btn btn-secondary btn-sm" data-lockreset>초기화</button>` : "아직 설정 안 함 (직원이 처음 열 때 정합니다)"}</div>`;
  el.innerHTML = lockLine + (list.length ? `<table class="tbl rec-tbl"><tbody>${list.map((s) => `<tr><td class="nowrap">${monthLabel(s.month)}</td><td>${typeBadge(s.type)}</td><td class="sub">${esc(s.fileName || "")}</td>
      <td class="sub">${s.viewedAt ? `열람 ${esc(fmtDT(s.viewedAt))}` : "미열람"}</td><td class="nowrap"><button class="btn btn-secondary btn-sm" data-sview="${esc(s.id)}">보기</button> <button class="btn btn-danger btn-sm" data-sdel="${esc(s.id)}">삭제</button></td></tr>`).join("")}</tbody></table>`
    : `<div class="msg">배포한 명세서가 없습니다. 관리 → 급여 배포에서 올리세요.</div>`);
  el.querySelector("[data-lockreset]")?.addEventListener("click", async () => {
    if (!confirm(`${emp.name} 님의 급여 열람 비밀번호를 초기화할까요? 직원이 다음에 열 때 새 비밀번호를 다시 정하게 됩니다.`)) return;
    try { await deleteDoc(doc(db, "employees", emp.id, "private", "payLock")); audit("paylock_reset", { targetEmployeeId: emp.id }); toast("초기화했습니다"); mountEmployeeSlips(el, emp); }
    catch (e) { console.error(e); toast(errMsg(e), true); }
  });
  el.querySelectorAll("[data-sview]").forEach((b) => (b.onclick = () => openSlip(list.find((x) => x.id === b.dataset.sview), emp.id, { mine: false })));
  el.querySelectorAll("[data-sdel]").forEach((b) => (b.onclick = async () => {
    const s = list.find((x) => x.id === b.dataset.sdel);
    if (!confirm(`${monthLabel(s.month)} ${SLIP_TYPES[s.type]} (${s.fileName})를 삭제할까요? 직원도 더 이상 볼 수 없습니다.`)) return;
    try { await removeSlip(emp.id, s); audit("payslip_delete", { targetEmployeeId: emp.id, detail: `${s.month} ${SLIP_TYPES[s.type]}` }); toast("삭제했습니다"); mountEmployeeSlips(el, emp); }
    catch (e) { console.error(e); toast(errMsg(e), true); }
  }));
}
async function removeSlip(empId, s) {
  try { await deleteObject(ref(storage, s.path)); } catch (e) { if (!String(e.code || "").includes("not-found")) throw e; }
  await deleteDoc(doc(db, "employees", empId, "payslips", s.id));
}

// ---------- 관리 → 급여 배포 ----------
// 종류와 월은 올릴 때 직접 고른다 (파일 이름에는 직원 이름만 있으면 된다). 한 번에 올리는 파일은 모두 같은 종류·월이다.
const D = { rows: [], busy: false };
const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m || "");

export function renderDistribute(body) {
  const emps = () => state.employees.filter((e) => e.status !== "resigned").sort((a, b) => a.name.localeCompare(b.name, "ko"));
  D.rows = D.rows.filter((r) => r.state !== "done");
  body.innerHTML = `<div class="card"><h2>급여 명세서·세부내역서 올리기</h2>
    <p>종류와 월을 고른 뒤 PDF 또는 이미지 파일(한 파일 10MB 이하)을 한꺼번에 올립니다. <b>파일 이름에는 직원 이름만</b> 들어 있으면 됩니다 (예: <span class="mono">김교사.pdf</span>). 이름으로 직원을 자동으로 맞추고, 못 찾았거나 동명이인인 파일은 표에서 직접 고릅니다. 올리면 직원이 로그인해 <b>‘내 급여’</b>에서 비밀번호를 한 번 더 입력하고 봅니다. 같은 직원·종류·월에 다시 올리면 새 파일로 바뀝니다.</p>
    <div class="grid-2"><div class="field"><label for="dsType">종류</label><select id="dsType">${Object.entries(SLIP_TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div>
      <div class="field"><label for="dsMonth">귀속 월</label><input class="input" id="dsMonth" type="month" value="${lastMonth()}"></div></div>
    <div class="dropzone" id="dsZone"><div class="dz-title">📎 파일을 끌어다 놓거나 클릭해서 선택 (여러 개)</div><input type="file" id="dsFiles" multiple accept="application/pdf,image/*,.pdf,.png,.jpg,.jpeg,.gif,.webp,.heic" class="hidden"></div>
    <div id="dsPreview"></div><div class="msg error" id="dsErr"></div></div>
    <div class="card"><h2>월별 배포 현황</h2><p class="sub">직원 수만큼 읽기가 발생합니다. 누가 받았고 열어 봤는지 확인합니다.</p>
      <div class="row-actions"><input class="input" id="dsStatMonth" type="month" value="${lastMonth()}" style="max-width:180px"> <button class="btn btn-secondary" id="btnDsStat">불러오기</button></div><div id="dsStat"></div></div>`;
  const zone = $("dsZone"), input = $("dsFiles");
  zone.onclick = () => input.click();
  input.onchange = () => { addFiles([...input.files]); input.value = ""; };
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => { e.preventDefault(); zone.classList.remove("dragover"); addFiles([...(e.dataTransfer?.files || [])]); });
  $("dsType").onchange = $("dsMonth").onchange = () => draw();
  $("btnDsStat").onclick = () => loadStatus();

  function addFiles(files) {
    const list = emps();
    for (const file of files) {
      const g = guessEmployee(file.name, list);
      D.rows.push({ file, err: isAllowedFile(file), empId: g.emp?.id || "", by: g.by, ambiguous: g.ambiguous ? g.ambiguous.map((e) => e.name).join("·") : "", state: "" });
    }
    draw();
  }
  // 올릴 수 있는 줄: 파일 이상 없음 + 직원 선택됨 + 같은 직원 파일이 앞에 없음 + 아직 안 올림
  function readiness() {
    const seen = new Set();
    return D.rows.map((r) => {
      if (r.state === "done") return "done";
      if (r.err) return "bad";
      if (!r.empId) return "noemp";
      if (seen.has(r.empId)) return "dup";
      seen.add(r.empId); return "ok";
    });
  }
  function draw() {
    const rows = D.rows, st = readiness(), month = $("dsMonth").value, type = $("dsType").value, monthOk = isMonth(month);
    const ready = rows.filter((r, i) => st[i] === "ok");
    const list = emps(), label = { ok: "준비됨", noemp: "직원을 선택하세요", dup: "같은 직원의 파일이 이미 목록에 있습니다 — 빼 주세요", done: "올림", bad: "" };
    $("dsPreview").innerHTML = rows.length ? `<p style="margin:12px 0 6px">올릴 내용: <b>${monthOk ? monthLabel(month) : "월을 선택하세요"} ${esc(SLIP_TYPES[type])}</b></p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>파일</th><th>직원</th><th>상태</th><th></th></tr></thead><tbody>${rows.map((r, i) => `<tr class="${r.err || st[i] === "dup" ? "bad" : ""}">
        <td class="sub" style="max-width:260px;overflow-wrap:anywhere">${esc(r.file.name)}</td>
        <td><select data-emp="${i}" ${r.state === "done" || D.busy ? "disabled" : ""}><option value="">— 선택 —</option>${list.map((e) => `<option value="${esc(e.id)}" ${e.id === r.empId ? "selected" : ""}>${esc(e.name)} (${esc(e.id)})</option>`).join("")}</select>${r.by ? ` <span class="sub">${r.by}으로 찾음</span>` : ""}${r.ambiguous ? ` <span class="sub">동명이인(${esc(r.ambiguous)}) — 직접 선택</span>` : ""}</td>
        <td class="res ${r.state === "done" ? "ok" : r.err || r.state === "fail" || st[i] === "dup" ? "bad" : ""}">${r.err ? esc(r.err) : r.state === "fail" ? "실패 — " + esc(r.failMsg || "") : r.state === "busy" ? "올리는 중…" : label[st[i]]}</td>
        <td><button class="btn btn-secondary btn-sm" data-rm="${i}" ${D.busy ? "disabled" : ""}>빼기</button></td></tr>`).join("")}</tbody></table></div>
      <div class="row-actions" style="margin-top:10px"><button class="btn btn-primary" id="btnDsUpload" ${ready.length && monthOk && !D.busy ? "" : "disabled"}>${ready.length}건 올리기</button> <button class="btn btn-secondary" id="btnDsClear" ${D.busy ? "disabled" : ""}>목록 비우기</button>
      <span class="sub">${rows.length - ready.length > 0 ? `${rows.length - ready.length}건은 올릴 수 없는 상태입니다` : ""}</span></div>` : "";
    $("dsPreview").querySelectorAll("[data-emp]").forEach((el) => (el.onchange = () => { const r = D.rows[Number(el.dataset.emp)]; r.empId = el.value; r.by = ""; r.ambiguous = ""; r.state = ""; draw(); }));
    $("dsPreview").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { D.rows.splice(Number(b.dataset.rm), 1); draw(); }));
    $("btnDsClear")?.addEventListener("click", () => { D.rows = []; draw(); });
    $("btnDsUpload")?.addEventListener("click", upload);
  }
  async function upload() {
    const st = readiness(), todo = D.rows.filter((r, i) => st[i] === "ok"), month = $("dsMonth").value, type = $("dsType").value;
    if (!todo.length || D.busy || !isMonth(month)) return;
    const names = [...new Set(todo.map((r) => state.employees.find((e) => e.id === r.empId)?.name))];
    if (!confirm(`${monthLabel(month)} ${SLIP_TYPES[type]} ${todo.length}건을 ${names.length}명에게 올립니다.\n직원이 로그인해서 비밀번호를 입력하면 바로 볼 수 있습니다. 계속할까요?`)) return;
    D.busy = true; $("dsErr").textContent = ""; let ok = 0, fail = 0;
    const one = async (r) => {
      r.state = "busy"; draw();
      try {
        const old = (await getDocs(slipsOf(r.empId))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.type === type && x.month === month);
        const path = `hr/${r.empId}/pay/${type}__${month}__${Date.now()}__${r.file.name.replace(/[\\/]/g, "_")}`, contentType = contentTypeOf(r.file);
        await uploadBytes(ref(storage, path), r.file, { contentType, customMetadata: { uploadedBy: auth.currentUser?.email || "" } });
        await addDoc(slipsOf(r.empId), { type, month, path, fileName: r.file.name, size: r.file.size, contentType, uploadedBy: auth.currentUser?.uid || "", uploadedByName: state.me?.name || auth.currentUser?.email || "", createdAt: serverTimestamp() });
        for (const x of old) { try { await removeSlip(r.empId, x); } catch (e) { console.warn("이전 파일 정리 실패", e.code || e); } }
        r.state = "done"; ok++;
      } catch (e) { console.error(e); r.state = "fail"; r.failMsg = errMsg(e); fail++; }
    };
    for (let i = 0; i < todo.length; i += 3) await Promise.all(todo.slice(i, i + 3).map(one));
    D.busy = false; draw();
    audit("payslip_upload", { detail: `${monthLabel(month)} ${SLIP_TYPES[type]} ${ok}건 성공${fail ? ` · ${fail}건 실패` : ""}` });
    if (fail) $("dsErr").textContent = `${fail}건이 실패했습니다. 표의 결과를 확인하고 다시 시도하세요.`;
    toast(`${ok}건을 올렸습니다${fail ? `, ${fail}건 실패` : ""}`, !!fail);
  }
  async function loadStatus() {
    const month = $("dsStatMonth").value; if (!isMonth(month)) return;
    $("dsStat").innerHTML = `<div class="msg">불러오는 중…</div>`;
    const list = emps(), rows = [];
    for (let k = 0; k < list.length; k += 8) await Promise.all(list.slice(k, k + 8).map(async (e) => {
      let slips = []; try { slips = (await getDocs(slipsOf(e.id))).docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => x.month === month); } catch {}
      rows.push({ e, slips });
    }));
    rows.sort((a, b) => a.e.name.localeCompare(b.e.name, "ko"));
    const cell = (r, t) => { const x = r.slips.filter((y) => y.type === t).sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt))[0]; return x ? `<span class="badge s-active">배포</span> <span class="sub">${x.viewedAt ? "열람 " + esc(fmtDT(x.viewedAt)) : "미열람"}</span>` : `<span class="sub">—</span>`; };
    const got = rows.filter((r) => r.slips.length).length;
    $("dsStat").innerHTML = `<p style="margin:10px 0">${monthLabel(month)}: 받은 직원 <b>${got}</b> / ${rows.length}명</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>소속</th><th>${SLIP_TYPES.salary}</th><th>${SLIP_TYPES.incentive}</th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="#emp/${esc(r.e.id)}">${esc(r.e.name)}</a></td><td class="sub">${esc(orgNames(r.e.orgIds))}</td><td>${cell(r, "salary")}</td><td>${cell(r, "incentive")}</td></tr>`).join("")}</tbody></table></div>`;
  }
  draw();
}
