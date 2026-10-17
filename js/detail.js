// 직원 상세 화면: 기본/지점, 주민등록번호, 개인정보, 급여(최고관리자), 서류 업로드, 증명서 발급
import { db, storage, auth } from "./firebase.js";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  ref, uploadBytes, listAll, getMetadata, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import {
  $, state, isSuper, isHR, isAdmin, canManage, esc, toast, errMsg, orgNames, orgName,
  statusBadge, levelBadge, toEmp, todayStr, renderOrgChecks, readOrgChecks, syncRoles
} from "./core.js";
import { STAMP_IMAGES, COMPANY_INFO } from "./company.js";

// 서류/파일 규칙 — storage.rules 와 반드시 같이 바꿀 것
const PERSONAL_FIELDS = [
  { key: "address",          label: "주소", half: true },
  { key: "bankAccount",      label: "계좌번호" },
  { key: "guardianName",     label: "보호자 성명" },
  { key: "guardianRelation", label: "보호자와의 관계" },
  { key: "guardianPhone",    label: "보호자 연락처" },
  { key: "eduStartDate",     label: "교육시작일", type: "date" },
  { key: "workStartDate",    label: "근로시작일", type: "date" },
  { key: "insuranceRegDate", label: "4대보험 등록일", type: "date" },
  { key: "resignDate",       label: "퇴사일", type: "date" },
];
const PUBLIC_DOCS = [
  { key: "resume", label: "이력서" }, { key: "portfolio", label: "포트폴리오" },
  { key: "criminalRecord", label: "범죄기록조회서" }, { key: "diploma", label: "졸업증명서" },
];
const SECRET_DOCS = [
  { key: "residentCopy", label: "주민등록등본" }, { key: "bankbookCopy", label: "통장사본" },
  { key: "businessRegistration", label: "사업자등록확인서" }, { key: "employmentInsuranceDoc", label: "고용보험 관련서류" },
];
const PUB_KEYS = PUBLIC_DOCS.map((d) => d.key);
const SEC_KEYS = SECRET_DOCS.map((d) => d.key);

let ctx = { openEdit: () => {}, reload: async () => {}, rerender: () => {} };
export function initDetail(c) { ctx = { ...ctx, ...c }; }

const cur = {
  id: "", emp: null, pi: {}, flags: {}, front: "", back: "", comp: {}, severance: [],
  files: { pub: [], sec: [] }, filesLoaded: false,
  token: 0, // 비동기 로딩 중 다른 직원으로 이동했는지 구분
};

// ---------- 권한 ----------
const isOwnPage = () => !!cur.emp && state.role?.employeeId === cur.id;
const mgrView   = () => canManage() && !state.selfMode;      // 관리 버튼 표시
const canSeeBack = () => isSuper();
const canSeeFront = () => isOwnPage() || canManage();
const canViewKey = (key) => (PUB_KEYS.includes(key) ? (isHR() || isAdmin()) : isSuper());
const canUploadKey = (key) => isSuper() || isOwnPage() || (PUB_KEYS.includes(key) && (isHR() || isAdmin()));

// ---------- 유틸 ----------
const get = async (...path) => {
  try { const s = await getDoc(doc(db, ...path)); return s.exists() ? s.data() : null; }
  catch (e) { console.warn("읽기 실패", path.join("/"), e.code || e); return null; }
};
const priv = (name) => ["employees", cur.id, "private", name];
const who = () => auth.currentUser?.email || (auth.currentUser?.isAnonymous ? "등록 링크" : "");
const fileParts = (name) => {
  const m = /^([A-Za-z0-9]+)__(\d+)__(.*)$/.exec(name);
  return m ? { key: m[1], ts: Number(m[2]), orig: m[3] } : { key: "", ts: 0, orig: name };
};
function randomToken() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------- 불러오기 ----------
async function listFolder(folder) {
  try {
    const res = await listAll(ref(storage, `hr/${cur.id}/${folder}`));
    const items = await Promise.all(res.items.map(async (it) => {
      const p = fileParts(it.name);
      let meta = {};
      if (p.key === "etc") { try { meta = (await getMetadata(it)).customMetadata || {}; } catch {} }
      return { path: it.fullPath, name: it.name, ...p, label: meta.label || "", description: meta.description || "" };
    }));
    return items.sort((a, b) => b.ts - a.ts);
  } catch (e) { console.warn("목록 실패", folder, e.code || e); return []; }
}

export async function renderDetail(empId) {
  const root = $("detailRoot");
  const token = ++cur.token;
  cur.id = empId;
  root.innerHTML = `<div class="card"><p class="msg" style="margin:0">불러오는 중…</p></div>`;
  const cached = state.employees.find((e) => e.id === empId);
  let emp = null;
  try { const s = await getDoc(doc(db, "employees", empId)); if (s.exists()) emp = toEmp(s); } catch (e) { console.warn(e); }
  emp = emp || cached;
  if (token !== cur.token) return;
  if (!emp) {
    root.innerHTML = `<div class="card"><h2>직원 정보를 찾을 수 없습니다</h2><p>삭제됐거나 볼 수 있는 권한이 없는 직원입니다.</p><a class="btn btn-secondary" href="#employees">목록으로</a></div>`;
    return;
  }
  cur.emp = emp;
  const [pi, flags, front, back, comp] = await Promise.all([
    get(...priv("personalInfo")), get(...priv("flags")),
    canSeeFront() ? get(...priv("residentFront")) : null,
    canSeeBack() ? get(...priv("residentBack")) : null,
    isSuper() ? get(...priv("compensation")) : null,
  ]);
  if (token !== cur.token) return;
  Object.assign(cur, {
    pi: pi || {}, flags: flags || {}, front: front?.value || "", back: back?.value || "",
    comp: comp || {}, severance: Array.isArray(comp?.severanceSettlements) ? comp.severanceSettlements.map((x) => ({ ...x })) : [],
    files: { pub: [], sec: [] }, filesLoaded: false,
  });
  draw();
  if (isHR() || isAdmin()) {
    const [pub, sec] = await Promise.all([listFolder("pub"), isSuper() ? listFolder("sec") : []]);
    if (token !== cur.token) return;
    cur.files = { pub, sec }; cur.filesLoaded = true;
    drawFiles();
  }
}

// ---------- 그리기 ----------
function draw() {
  const e = cur.emp, root = $("detailRoot"), mgr = mgrView();
  const showBack = !state.selfMode && !(isOwnPage() && !canManage());
  root.innerHTML = `
    ${showBack ? `<a class="back-link" href="#employees">← 목록으로</a>` : ""}
    ${state.selfMode ? `<div class="notice" style="margin-bottom:16px">내 정보를 직접 입력하는 페이지입니다. 저장한 내용은 담당 관리자에게 전달됩니다. 이미 등록한 주민등록번호 뒷자리와 서류는 본인도 다시 볼 수 없습니다.</div>` : ""}
    <div class="card">
      <div class="head-top">
        <h2 class="emp-name">${esc(e.name)}</h2>
        ${mgr ? `<div class="row-actions">
          <button class="btn btn-secondary" id="dBtnEdit">기본 정보 수정</button>
          <button class="btn btn-secondary" id="dBtnLink">등록 링크 복사</button>
          <button class="btn btn-secondary" id="dBtnCert" data-type="current">재직증명서 발급</button>
          <button class="btn btn-secondary" id="dBtnCareer" data-type="career">경력증명서 발급</button>
        </div>` : ""}
      </div>
      <div class="label">전번</div>
      <div class="big-phone">${esc(e.phone || "—")}</div>
      <div class="tags-row">${statusBadge(e.status)} ${levelBadge(e.level)} <span class="mono sub">${esc(e.id)}</span></div>
      <div class="label" style="margin-top:14px">소속 지점 (중복 선택 가능)</div>
      <div class="chk-group" id="dBranches"></div>
      ${isHR() && !state.selfMode ? `<button class="btn btn-secondary" id="dBtnBranches" style="margin-top:12px">지점 저장</button>` : ""}
    </div>

    <div class="card">
      <h3 class="sec-title">주민등록번호</h3>
      <div class="rrn-row">
        <input class="input" id="dFront" inputmode="numeric" maxlength="6" placeholder="앞 6자리" autocomplete="off" value="${esc(cur.front)}" ${canSeeFront() ? "" : ""}>
        <span class="sep">-</span>
        <input class="input" id="dBack" type="password" inputmode="numeric" maxlength="7" placeholder="뒤 7자리" autocomplete="new-password" value="${esc(cur.back)}">
        ${canSeeBack() ? `<button class="btn btn-secondary" id="dBtnShow" type="button">보기</button>` : ""}
      </div>
      <div class="msg" id="dRrnStatus"></div>
      <button class="btn btn-primary" id="dBtnRrn" style="margin-top:10px">주민번호 저장</button>
    </div>

    <div class="card">
      <h3 class="sec-title">개인 정보</h3>
      <div class="grid-fields">
        <div class="field half"><label>이메일</label><input class="input" value="${esc(e.email || "")}" disabled>
          <span class="help">로그인에 쓰는 이메일입니다. ${canManage() ? "‘기본 정보 수정’에서 바꿀 수 있습니다." : "바꾸려면 관리자에게 요청하세요."}</span></div>
        ${PERSONAL_FIELDS.map((f) => `<div class="field ${f.half ? "half" : ""}"><label>${f.label}</label>
          <input class="input" data-pi="${f.key}" type="${f.type || "text"}" maxlength="200" value="${esc(cur.pi[f.key] || "")}"></div>`).join("")}
      </div>
      <button class="btn btn-primary" id="dBtnPi" style="margin-top:12px">개인정보 저장</button>
    </div>

    ${isSuper() ? compHtml() : ""}

    <div class="card"><h3 class="sec-title">공개서류 (이력서·포트폴리오·범죄기록조회서·졸업증명서)</h3><div id="dPub"></div></div>
    <div class="card"><h3 class="sec-title">비공개서류 (주민등록등본·통장사본·사업자등록확인서·고용보험 관련서류)</h3><div id="dSec"></div></div>
    ${isSuper() ? `
    <div class="card"><h3 class="sec-title">인사 평가 파일</h3>
      <div class="dropzone" id="dEvalZone"><div class="dz-title">📎 여러 파일을 한번에 끌어다 놓거나 클릭해서 선택</div><div class="sub">(여러 개 선택 가능)</div>
        <input type="file" id="dEvalInput" multiple hidden></div>
      <div id="dEval" style="margin-top:12px"></div></div>
    <div class="card"><h3 class="sec-title">기타</h3><div id="dEtc"></div>
      <button class="btn btn-secondary" id="dBtnEtc" style="margin-top:8px">+ 항목 추가</button></div>` : ""}
  `;
  renderOrgChecks($("dBranches"), { selected: e.orgIds, disabled: !isHR() || state.selfMode });
  rrnStatus();
  bindHead(); bindRrn(); bindPi();
  if (isSuper()) bindComp();
  if (isSuper()) bindEval();
  drawFiles();
}

// 추가급여 1~3: 항목명(직접 입력) + 금액. 예전 단일 ‘추가급여’ 값은 추가급여1 로 이어받음
function addRow(n, c) {
  const legacy = n === 1 && !("additionalSalary1" in c) ? c.additionalSalary : undefined;
  const amount = c["additionalSalary" + n] ?? legacy ?? "";
  return `<div class="add-row"><span class="add-tag">추가급여${n}</span>
    <input class="input" id="cAddLabel${n}" maxlength="30" placeholder="항목명 (예: ${["자기 계발비", "차량 지원금", "직책 수당"][n - 1]})" value="${esc(c["additionalLabel" + n] || "")}">
    <input class="input" id="cAdd${n}" type="number" min="0" placeholder="0" value="${esc(amount)}"><span class="help">원</span></div>`;
}

function compHtml() {
  const c = cur.comp;
  const num = (id, label, v) => `<div class="field"><label>${label}</label><input class="input" id="${id}" type="number" min="0" placeholder="0" value="${esc(v ?? "")}"><span class="help">원</span></div>`;
  return `<div class="card"><h3 class="sec-title">급여 정보 (최고관리자 전용)</h3>
    <div class="grid-2">${num("cBase", "기본급", c.baseSalary)}${num("cMeal", "식대", c.mealAllowance)}</div>
    <div class="add-pay">${[1, 2, 3].map((n) => addRow(n, c)).join("")}</div>
    <div class="grid-2">
      <div class="field"><label>인센티브 - 초과 기준</label><input class="input" id="cIncTh" placeholder="예: 5명 초과" value="${esc(c.incentiveThreshold || "")}"></div>
      ${num("cIncAmt", "인센티브 - 금액", c.incentiveAmount)}</div>
    <div class="field"><label>기타 급여</label><input class="input" id="cOther" placeholder="기타 급여 내역" value="${esc(c.otherSalary || "")}"></div>
    <div class="field"><label>퇴직금 중간 정산</label><div id="cSev"></div>
      <button class="btn btn-secondary" id="cBtnSev" type="button" style="margin-top:6px;align-self:flex-start">+ 추가</button></div>
    <div class="field"><label>메모</label><textarea id="cMemo" rows="5" placeholder="메모">${esc(c.memo || "")}</textarea></div>
    <button class="btn btn-primary" id="cBtnSave" style="margin-top:8px">급여 정보 저장</button></div>`;
}

// ---------- 상단: 지점/링크/증명서 ----------
function bindHead() {
  $("dBtnEdit")?.addEventListener("click", () => ctx.openEdit(cur.emp));
  $("dBtnLink")?.addEventListener("click", copySelfLink);
  $("dBtnCert")?.addEventListener("click", () => openCert("current"));
  $("dBtnCareer")?.addEventListener("click", () => openCert("career"));
  $("dBtnBranches")?.addEventListener("click", async () => {
    const ids = readOrgChecks($("dBranches"));
    if (!ids.length) return toast("지점을 하나 이상 선택하세요.", true);
    try {
      await updateDoc(doc(db, "employees", cur.id), { orgIds: ids, orgId: ids[0], updatedAt: serverTimestamp() });
      await syncRoles(cur.id, { level: cur.emp.level, orgId: ids[0], status: cur.emp.status });
      toast("지점 정보를 저장했습니다");
      await ctx.reload();
      await renderDetail(cur.id);
    } catch (e) { console.error(e); toast(errMsg(e), true); }
  });
}

async function copySelfLink() {
  try {
    let token = cur.emp.selfToken;
    if (!token) {
      token = randomToken();
      await updateDoc(doc(db, "employees", cur.id), { selfToken: token, updatedAt: serverTimestamp() });
      cur.emp.selfToken = token;
    }
    const u = new URL("./", location.href);
    u.search = ""; u.hash = "";
    u.searchParams.set("self", cur.id); u.searchParams.set("t", token);
    const url = u.toString();
    try { await navigator.clipboard.writeText(url); toast("등록 링크를 복사했습니다"); }
    catch { prompt("아래 링크를 복사하세요", url); }
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

// ---------- 주민등록번호 ----------
function rrnStatus() {
  const f = cur.flags.residentFront, b = cur.flags.residentBack;
  const fl = f ? (canSeeFront() ? "앞자리: 등록됨" : "앞자리: 이미 등록됨 (조회 불가)") : "앞자리: 미등록";
  const bl = b ? (canSeeBack() ? "뒷자리: 등록됨" : "뒷자리: 이미 등록됨 (조회 불가)") : "뒷자리: 미등록";
  $("dRrnStatus").textContent = `${fl} · ${bl}`;
}
function bindRrn() {
  $("dBtnShow")?.addEventListener("click", () => { const i = $("dBack"); i.type = i.type === "password" ? "text" : "password"; });
  $("dBtnRrn").addEventListener("click", async () => {
    const front = $("dFront").value.trim(), back = $("dBack").value.trim();
    if (!front && !back) return toast("입력된 값이 없습니다.", true);
    if (front && !/^\d{6}$/.test(front)) return toast("앞자리는 숫자 6자리입니다.", true);
    if (back && !/^\d{7}$/.test(back)) return toast("뒷자리는 숫자 7자리입니다.", true);
    try {
      const meta = { updatedAt: serverTimestamp(), updatedBy: who() };
      const flags = {};
      if (front) { await setDoc(doc(db, ...priv("residentFront")), { value: front, ...meta }); flags.residentFront = true; cur.front = front; }
      if (back)  { await setDoc(doc(db, ...priv("residentBack")), { value: back, ...meta }); flags.residentBack = true; if (canSeeBack()) cur.back = back; }
      await setDoc(doc(db, ...priv("flags")), flags, { merge: true });
      Object.assign(cur.flags, flags);
      if (!canSeeBack()) $("dBack").value = "";
      if (!canSeeFront()) $("dFront").value = "";
      rrnStatus();
      toast("저장했습니다");
    } catch (e) { console.error(e); toast(errMsg(e), true); }
  });
}

// ---------- 개인정보 ----------
function normDateStr(s) {
  if (!s) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function bindPi() {
  $("dBtnPi").addEventListener("click", async () => {
    const vals = {};
    for (const inp of document.querySelectorAll("#detailRoot [data-pi]")) {
      const v = inp.value.trim();
      if (inp.type === "date" && normDateStr(v) === null) return toast("날짜 형식이 올바르지 않습니다.", true);
      vals[inp.dataset.pi] = v;
    }
    try {
      await setDoc(doc(db, ...priv("personalInfo")), { ...vals, updatedAt: serverTimestamp() }, { merge: true });
      Object.assign(cur.pi, vals);
      toast("저장했습니다");
    } catch (e) { console.error(e); toast(errMsg(e), true); }
  });
}

// ---------- 급여 ----------
function drawSev() {
  const wrap = $("cSev"); if (!wrap) return;
  wrap.innerHTML = cur.severance.map((s, i) => `<div class="sev-row">
      <input class="input" type="number" placeholder="년" data-sev="${i}.year" value="${esc(s.year ?? "")}">
      <input class="input" type="number" placeholder="월" data-sev="${i}.month" value="${esc(s.month ?? "")}">
      <input class="input" type="number" placeholder="일" data-sev="${i}.day" value="${esc(s.day ?? "")}">
      <input class="input" type="number" placeholder="금액(원)" data-sev="${i}.amount" value="${esc(s.amount ?? "")}">
      <button class="btn btn-danger" type="button" data-sev-del="${i}">삭제</button></div>`).join("");
  wrap.querySelectorAll("[data-sev]").forEach((inp) => inp.addEventListener("input", () => {
    const [i, k] = inp.dataset.sev.split("."); cur.severance[Number(i)][k] = inp.value;
  }));
  wrap.querySelectorAll("[data-sev-del]").forEach((b) => b.addEventListener("click", () => {
    cur.severance.splice(Number(b.dataset.sevDel), 1); drawSev();
  }));
}
function bindComp() {
  drawSev();
  $("cBtnSev").addEventListener("click", () => { cur.severance.push({ year: "", month: "", day: "", amount: "" }); drawSev(); });
  $("cBtnSave").addEventListener("click", async () => {
    const v = (id) => $(id).value.trim();
    const payload = {
      baseSalary: v("cBase"), mealAllowance: v("cMeal"),
      additionalSalary1: v("cAdd1"), additionalLabel1: v("cAddLabel1"),
      additionalSalary2: v("cAdd2"), additionalLabel2: v("cAddLabel2"),
      additionalSalary3: v("cAdd3"), additionalLabel3: v("cAddLabel3"),
      incentiveThreshold: v("cIncTh"), incentiveAmount: v("cIncAmt"), otherSalary: v("cOther"), memo: v("cMemo"),
      severanceSettlements: cur.severance.map((s) => ({ year: String(s.year ?? ""), month: String(s.month ?? ""), day: String(s.day ?? ""), amount: String(s.amount ?? "") })),
      updatedAt: serverTimestamp(), updatedBy: who(),
    };
    try { await setDoc(doc(db, ...priv("compensation")), payload, { merge: true }); toast("급여 정보를 저장했습니다"); }
    catch (e) { console.error(e); toast(errMsg(e), true); }
  });
}

// ---------- 서류 ----------
function dropzone(el, onFiles) {
  el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("dragover"); });
  el.addEventListener("dragleave", () => el.classList.remove("dragover"));
  el.addEventListener("drop", (e) => { e.preventDefault(); el.classList.remove("dragover"); if (e.dataTransfer?.files?.length) onFiles([...e.dataTransfer.files]); });
}
const safeName = (n) => String(n).replace(/[\\/]/g, "_");
const folderOf = (key) => (PUB_KEYS.includes(key) ? "pub" : "sec");
const MAX_MB = 30;

async function putFile(folder, key, file, custom = {}) {
  if (file.size > MAX_MB * 1024 * 1024) throw new Error(`파일이 너무 큽니다 (최대 ${MAX_MB}MB)`);
  const name = `${key}__${Date.now()}__${safeName(file.name)}`;
  await uploadBytes(ref(storage, `hr/${cur.id}/${folder}/${name}`), file, { customMetadata: { uploadedBy: who(), ...custom } });
  return name;
}

function slotHtml(item) {
  const key = item.key, view = canViewKey(key), up = canUploadKey(key);
  const mine = (cur.files[folderOf(key)] || []).filter((f) => f.key === key);
  const latest = mine[0];
  let status;
  if (view) {
    status = latest
      ? `<span class="file-status">✔ ${esc(latest.orig)}</span> <button class="btn btn-secondary btn-sm" data-dl="${esc(latest.path)}" data-name="${esc(latest.orig)}">다운로드</button> <button class="btn btn-danger btn-sm" data-del-key="${key}">삭제</button>`
      : (cur.filesLoaded ? `<span class="file-status empty">미업로드</span>` : `<span class="file-status empty">불러오는 중…</span>`);
  } else {
    status = cur.flags.uploaded?.[key] ? `<span class="file-status">✔ 이미 등록됨 (열람은 ${PUB_KEYS.includes(key) ? "담당 관리자" : "최고관리자"}만 가능)</span>` : `<span class="file-status empty">미등록</span>`;
  }
  return `<div class="file-slot" data-slot="${key}"><div class="label-row"><div class="label">${item.label}</div><div>${status}</div></div>
    ${up ? `<div class="dropzone" data-zone="${key}"><div class="dz-title">📎 파일을 끌어다 놓거나 클릭해서 선택</div><input type="file" data-up="${key}" hidden></div>` : ""}</div>`;
}

function drawFiles() {
  const pubEl = $("dPub"), secEl = $("dSec");
  if (!pubEl || !secEl) return;
  pubEl.innerHTML = PUBLIC_DOCS.map(slotHtml).join("");
  secEl.innerHTML = SECRET_DOCS.map(slotHtml).join("");
  for (const item of [...PUBLIC_DOCS, ...SECRET_DOCS]) {
    const slot = document.querySelector(`[data-slot="${item.key}"]`); if (!slot) continue;
    const zone = slot.querySelector(".dropzone"), input = slot.querySelector("input[type=file]");
    if (zone) {
      zone.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
      input.addEventListener("change", () => { if (input.files[0]) uploadFixed(item, input.files[0]); input.value = ""; });
      dropzone(zone, (fs) => uploadFixed(item, fs[0]));
    }
    slot.querySelector("[data-dl]")?.addEventListener("click", (e) => download(e.currentTarget.dataset.dl, e.currentTarget.dataset.name));
    slot.querySelector("[data-del-key]")?.addEventListener("click", () => deleteFixed(item));
  }
  if (isSuper()) { drawEval(); drawEtc(); }
}

async function uploadFixed(item, file) {
  if (!file) return;
  toast(`${item.label} 업로드 중…`);
  try {
    const folder = folderOf(item.key);
    const old = canViewKey(item.key) ? cur.files[folder].filter((f) => f.key === item.key) : [];
    await putFile(folder, item.key, file, { originalName: file.name });
    await setDoc(doc(db, ...priv("flags")), { uploaded: { [item.key]: true } }, { merge: true });
    cur.flags.uploaded = { ...(cur.flags.uploaded || {}), [item.key]: true };
    for (const f of old) { try { await deleteObject(ref(storage, f.path)); } catch {} }   // 이전 버전 정리
    if (canViewKey(item.key)) cur.files[folder] = await listFolder(folder);
    drawFiles();
    toast(`${item.label} 업로드 완료`);
  } catch (e) { console.error(e); toast("업로드 실패: " + errMsg(e), true); }
}

async function deleteFixed(item) {
  if (!confirm(`"${item.label}" 파일을 삭제할까요?\n되돌릴 수 없습니다.`)) return;
  try {
    const folder = folderOf(item.key);
    for (const f of cur.files[folder].filter((x) => x.key === item.key)) await deleteObject(ref(storage, f.path));
    await setDoc(doc(db, ...priv("flags")), { uploaded: { [item.key]: false } }, { merge: true });
    cur.flags.uploaded = { ...(cur.flags.uploaded || {}), [item.key]: false };
    cur.files[folder] = await listFolder(folder);
    drawFiles(); toast("삭제했습니다");
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

async function download(path, name) {
  try {
    const url = await getDownloadURL(ref(storage, path));
    const a = document.createElement("a");
    a.href = url; a.download = name || "file"; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { console.error(e); toast("다운로드 실패: " + errMsg(e), true); }
}

// 인사 평가 파일 (여러 개)
function drawEval() {
  const wrap = $("dEval"); if (!wrap) return;
  const list = cur.files.sec.filter((f) => f.key === "eval");
  wrap.innerHTML = list.length ? list.map((f, i) => `<div class="file-slot slim"><div class="label-row"><div class="label">${esc(f.orig)}</div>
      <div><button class="btn btn-secondary btn-sm" data-dl="${esc(f.path)}" data-name="${esc(f.orig)}">다운로드</button>
      <button class="btn btn-danger btn-sm" data-del-path="${esc(f.path)}" data-del-name="${esc(f.orig)}">삭제</button></div></div></div>`).join("")
    : `<div class="msg">업로드된 파일이 없습니다.</div>`;
  wrap.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => download(b.dataset.dl, b.dataset.name)));
  wrap.querySelectorAll("[data-del-path]").forEach((b) => b.addEventListener("click", () => deleteByPath(b.dataset.delPath, b.dataset.delName)));
}
async function deleteByPath(path, label) {
  if (!confirm(`"${label}" 을(를) 삭제할까요?\n되돌릴 수 없습니다.`)) return;
  try { await deleteObject(ref(storage, path)); cur.files.sec = await listFolder("sec"); drawFiles(); toast("삭제했습니다"); }
  catch (e) { console.error(e); toast(errMsg(e), true); }
}
function bindEval() {
  const zone = $("dEvalZone"), input = $("dEvalInput");
  const go = async (files) => {
    if (!files.length) return;
    toast(`${files.length}개 파일 업로드 중…`);
    try {
      for (const f of files) await putFile("sec", "eval", f);
      cur.files.sec = await listFolder("sec"); drawFiles(); toast("업로드 완료");
    } catch (e) { console.error(e); toast("업로드 실패: " + errMsg(e), true); }
  };
  zone.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  input.addEventListener("change", () => { go([...input.files]); input.value = ""; });
  dropzone(zone, go);
  $("dBtnEtc").addEventListener("click", addEtcDraft);
}

// 기타 (항목명 + 설명 + 파일)
function drawEtc() {
  const wrap = $("dEtc"); if (!wrap) return;
  const drafts = [...wrap.querySelectorAll(".etc-draft")];
  const list = cur.files.sec.filter((f) => f.key === "etc");
  const saved = list.length ? list.map((f) => `<div class="file-slot slim"><div class="label-row"><div><div class="label">${esc(f.label || f.orig)}</div>
      ${f.description ? `<div class="sub">${esc(f.description)}</div>` : ""}<div class="sub">${esc(f.orig)}</div></div>
      <div><button class="btn btn-secondary btn-sm" data-dl="${esc(f.path)}" data-name="${esc(f.orig)}">다운로드</button>
      <button class="btn btn-danger btn-sm" data-del-path="${esc(f.path)}" data-del-name="${esc(f.label || f.orig)}">삭제</button></div></div></div>`).join("")
    : `<div class="msg" id="dEtcEmpty">등록된 항목이 없습니다.</div>`;
  wrap.innerHTML = saved;
  drafts.forEach((d) => wrap.appendChild(d));
  wrap.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => download(b.dataset.dl, b.dataset.name)));
  wrap.querySelectorAll("[data-del-path]").forEach((b) => b.addEventListener("click", () => deleteByPath(b.dataset.delPath, b.dataset.delName)));
}
function addEtcDraft() {
  const wrap = $("dEtc");
  const div = document.createElement("div");
  div.className = "etc-draft";
  div.innerHTML = `<input class="input" data-f="label" placeholder="항목명 (예: 자격증 사본)" maxlength="60">
    <textarea class="input" data-f="desc" rows="2" placeholder="파일 설명 (선택)" maxlength="200"></textarea>
    <div class="dropzone"><div class="dz-title">📎 파일을 끌어다 놓거나 클릭해서 선택</div><div class="sub" data-f="picked"></div><input type="file" hidden></div>
    <div class="row-actions" style="margin-top:8px"><button class="btn btn-primary" data-f="go" type="button">업로드</button><button class="btn btn-secondary" data-f="cancel" type="button">취소</button></div>`;
  wrap.appendChild(div);
  let picked = null;
  const zone = div.querySelector(".dropzone"), input = div.querySelector("input[type=file]");
  const pick = (f) => { picked = f; div.querySelector('[data-f="picked"]').textContent = f ? f.name : ""; };
  zone.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  input.addEventListener("change", () => pick(input.files[0] || null));
  dropzone(zone, (fs) => pick(fs[0]));
  div.querySelector('[data-f="cancel"]').addEventListener("click", () => div.remove());
  div.querySelector('[data-f="go"]').addEventListener("click", async () => {
    const label = div.querySelector('[data-f="label"]').value.trim();
    const description = div.querySelector('[data-f="desc"]').value.trim();
    if (!label || !picked) return toast("항목명과 파일을 모두 입력하세요.", true);
    toast("업로드 중…");
    try {
      await putFile("sec", "etc", picked, { label, description });
      cur.files.sec = await listFolder("sec"); div.remove(); drawFiles(); toast("업로드 완료");
    } catch (e) { console.error(e); toast("업로드 실패: " + errMsg(e), true); }
  });
}

// 직원 완전 삭제 시 하위 데이터/파일 정리 (최고관리자)
export async function deleteEmployeeData(empId) {
  for (const n of ["personalInfo", "flags", "residentFront", "residentBack", "compensation"]) {
    try { await deleteDoc(doc(db, "employees", empId, "private", n)); } catch (e) { console.warn("삭제 실패", n, e.code || e); }
  }
  for (const folder of ["pub", "sec"]) {
    try {
      const res = await listAll(ref(storage, `hr/${empId}/${folder}`));
      for (const it of res.items) { try { await deleteObject(it); } catch {} }
    } catch (e) { console.warn("파일 정리 실패", folder, e.code || e); }
  }
}

// ---------- 증명서 발급 ----------
let certType = "current";
function openCert(type) {
  certType = type;
  const e = cur.emp;
  $("certTitle").textContent = type === "career" ? "경력증명서 발급" : "재직증명서 발급";
  $("certPosition").value = e.position || "";
  $("certDuties").value = "";
  $("certBranch").value = orgNames(e.orgIds);
  $("certPurpose").value = "기관제출용";
  $("certApplyDate").value = cur.pi.workStartDate || e.joinedAt || "";
  $("certIssueDate").value = todayStr();
  $("certCompany").value = ""; $("certCeo").value = ""; $("certAddr").value = "";
  $("dlgCert").showModal();
}
export function bindCertModal() {
  $("certCompany").addEventListener("change", () => {
    const info = COMPANY_INFO[$("certCompany").value];
    if (info) { $("certCeo").value = info.ceo; $("certAddr").value = info.address; }
  });
  $("btnCertCancel").addEventListener("click", () => $("dlgCert").close());
  $("btnCertGo").addEventListener("click", generateCert);
}
function generateCert() {
  const e = cur.emp, v = (id) => $(id).value.trim();
  const isCareer = certType === "career";
  const docTitle = isCareer ? "경력증명서" : "재직증명서";
  const applyDate = $("certApplyDate").value || cur.pi.workStartDate || "";
  const resignDate = cur.pi.resignDate || "";
  const period = e.status === "resigned" && resignDate ? `${applyDate || "-"} ~ ${resignDate} (퇴직)` : `${applyDate || "-"} ~ 현재 (재직중)`;
  const rrn = cur.front ? `${cur.front} - ●●●●●●●` : "(미등록)";
  const company = v("certCompany"), stamp = COMPANY_INFO[company] ? STAMP_IMAGES[COMPANY_INFO[company].stampKey] : "";
  const row = (l, val) => val ? `<tr><td class="label">${l}</td><td>${esc(val)}</td></tr>` : "";
  const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${docTitle} - ${esc(e.name)}</title>
<style>
  body{font-family:"Malgun Gothic","Pretendard",sans-serif;padding:60px;color:#111}
  h1{text-align:center;font-size:28px;letter-spacing:20px;margin-bottom:60px}
  table{width:100%;border-collapse:collapse;margin-bottom:40px}
  td{border:1px solid #333;padding:12px 16px;font-size:15px}
  td.label{background:#f2f2f2;width:160px;font-weight:700}
  .stmt{font-size:15px;line-height:1.8;margin:40px 0;text-align:center}
  .foot{margin-top:80px;text-align:center;font-size:15px;line-height:2}
  .foot .date{margin-bottom:40px}
  .ceo-line{display:inline-flex;align-items:center;gap:6px}
  .stamp-slot{position:relative;display:inline-block;width:64px;height:44px;text-align:center}
  .stamp-slot img{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;mix-blend-mode:multiply}
  @media print{body{padding:30px}}
</style></head><body>
  <h1>${docTitle}</h1>
  <table>
    ${row("성명", e.name)}${row("주민등록번호", rrn)}${row("직위/직책", v("certPosition"))}${row("담당업무", v("certDuties"))}${row("소속", v("certBranch"))}
    ${row(isCareer ? "근무기간" : "재직기간", period)}${row("용도", v("certPurpose") || "기관제출용")}
  </table>
  <div class="stmt">${isCareer ? "위 사람은 위와 같이 본 기관에서 근무하였음을 증명합니다." : "위 사람은 위와 같이 재직하고 있음을 증명합니다."}</div>
  <div class="foot"><div class="date">${esc($("certIssueDate").value || todayStr())}</div>
    ${company ? `<div>회사명: ${esc(company)}</div>` : ""}${v("certAddr") ? `<div>주소: ${esc(v("certAddr"))}</div>` : ""}
    ${v("certCeo") ? `<div class="ceo-line">대표자: ${esc(v("certCeo"))}<span class="stamp-slot">(인)${stamp ? `<img src="${stamp}">` : ""}</span></div>` : ""}
  </div>
  <script>window.onload=()=>window.print();<\/script></body></html>`;
  const w = window.open("", "_blank");
  if (!w) return toast("팝업이 차단됐습니다. 팝업을 허용한 뒤 다시 시도하세요.", true);
  w.document.write(html); w.document.close();
  $("dlgCert").close();
}
