// 자라다 People — 메인 앱 (로그인 → 권한 확인 → 대시보드/직원/조직/내 정보)
import { auth, db } from "./firebase.js";
import {
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, limit, runTransaction, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

// ---------- 상수 ----------
const LEVELS    = { super: "최고관리자", admin: "관리자", staff: "직원" };
const STATUS    = { active: "재직", leave: "휴직", resigned: "퇴직" };
const ORG_TYPES = { hq: "본사", branch: "지점" };
const NAV = [
  { id: "dash",      label: "대시보드", view: "Dash",      levels: ["super", "admin"] },
  { id: "employees", label: "직원",     view: "Employees", levels: ["super", "admin"] },
  { id: "orgs",      label: "조직",     view: "Orgs",      levels: ["super", "admin", "staff"] },
  { id: "me",        label: "내 정보",  view: "Me",        levels: ["super", "admin", "staff"] },
];
const VIEWS = ["Login", "Loading", "NoRole", "Dash", "Employees", "Orgs", "Me"];

// ---------- 상태 ----------
const state = {
  user: null, role: null,
  orgs: [], employees: [], me: null,
  editing: null, editingOrg: null,
  noRoleReason: "",
};
const isSuper   = () => state.role?.level === "super";
const isAdmin   = () => state.role?.level === "admin";
const canManage = () => isSuper() || isAdmin();

// ---------- 유틸 ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 4500 : 2200);
}
function errMsg(e) {
  const code = String(e?.code || "");
  if (code.includes("permission-denied"))
    return "권한이 없습니다. Firestore 보안 규칙(firestore.rules)이 게시됐는지, 권한 문서가 맞는지 확인하세요.";
  if (code.includes("unavailable")) return "네트워크 연결을 확인해주세요.";
  if (code.includes("failed-precondition"))
    return "Firestore 인덱스가 필요합니다. 브라우저 콘솔(F12)의 링크에서 인덱스를 생성하세요.";
  return e?.message || String(e);
}
function showView(name) {
  VIEWS.forEach((v) => $("view" + v).classList.toggle("hidden", v !== name));
}
function orgName(id) { return state.orgs.find((o) => o.id === id)?.name || id || "—"; }
function badge(cls, text) { return `<span class="badge ${cls}">${esc(text)}</span>`; }
function statusBadge(s) { return badge("s-" + (STATUS[s] ? s : "resigned"), STATUS[s] || s || "—"); }
function levelBadge(l)  { return badge("l-" + (LEVELS[l] ? l : "staff"), LEVELS[l] || l || "—"); }
function orgTypeBadge(t){ return badge("o-" + (ORG_TYPES[t] ? t : "branch"), ORG_TYPES[t] || t || "—"); }
function fmtDate(s) { return s || "—"; }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function tsMillis(t) { return t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0); }
const toEmp = (d) => ({ id: d.id, ...d.data() });

// ---------- 인증 ----------
$("btnLogin").onclick = async () => {
  const m = $("loginMsg");
  m.textContent = ""; m.className = "msg";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    m.className = "msg error";
    if (e.code === "auth/unauthorized-domain") {
      m.textContent = "이 주소가 Firebase 승인된 도메인에 없습니다. Authentication → 설정 → 승인된 도메인에 추가하세요.";
    } else if (e.code === "auth/popup-blocked") {
      m.textContent = "팝업이 차단됐습니다. 주소창 오른쪽에서 팝업을 허용해주세요.";
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      m.textContent = "로그인 실패: " + (e.code || e.message);
    }
  }
};
$("btnLogout").onclick  = () => signOut(auth);
$("btnLogout2").onclick = () => signOut(auth);
$("btnRetry").onclick   = () => state.user && enter(state.user);
$("btnReload").onclick  = () => state.user && enter(state.user);

onAuthStateChanged(auth, (user) => {
  state.user = user;
  if (!user) { resetApp(); return; }
  $("topWho").textContent = user.email || user.uid;
  $("btnLogout").classList.remove("hidden");
  enter(user);
});

function resetApp() {
  state.role = null; state.orgs = []; state.employees = []; state.me = null;
  $("topWho").textContent = "로그인 안 됨";
  $("appSub").textContent = "통합 HR";
  $("nav").classList.add("hidden"); $("nav").innerHTML = "";
  $("btnLogout").classList.add("hidden");
  showView("Login");
}

async function enter(user) {
  showView("Loading");
  $("loadingMsg").textContent = "권한 확인 중…";
  $("btnReload").classList.add("hidden");
  $("nav").classList.add("hidden");
  try {
    const role = await resolveRole(user);
    if (!role) {
      const email = esc(user.email || "(이메일 없음)");
      if (state.noRoleReason === "resigned") {
        $("noRoleTitle").textContent = "퇴직 처리된 계정입니다";
        $("noRoleMsg").innerHTML = `<strong>${email}</strong> 계정은 퇴직 상태로 등록돼 있어 이용할 수 없습니다. 관리자에게 문의하세요.`;
      } else {
        $("noRoleTitle").textContent = "등록된 직원 정보가 없습니다";
        $("noRoleMsg").innerHTML = `로그인한 계정(<strong>${email}</strong>)으로 등록된 직원이 없습니다. 관리자에게 이 구글 계정 이메일로 직원 등록을 요청하세요. 등록이 끝나면 ‘다시 확인’을 누르거나 다시 로그인하면 권한이 자동으로 연결됩니다.`;
      }
      showView("NoRole");
      return;
    }
    state.role = role;
    $("loadingMsg").textContent = "데이터 불러오는 중…";
    await loadAll();
    buildNav();
    route();
  } catch (e) {
    console.error(e);
    $("loadingMsg").innerHTML = `<span class="msg error" style="margin:0">${esc(errMsg(e))}</span>`;
    $("btnReload").classList.remove("hidden");
  }
}

// roles/{uid} 조회. 없으면 이메일이 일치하는 직원 문서로 셀프 등록
async function resolveRole(user) {
  state.noRoleReason = "";
  const ref = doc(db, "roles", user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return snap.data();

  const email = (user.email || "").toLowerCase();
  if (!email) return null;
  const qs = await getDocs(query(collection(db, "employees"), where("email", "==", email), limit(1)));
  if (qs.empty) return null;
  const emp = qs.docs[0]; const d = emp.data();
  if (d.status === "resigned") { state.noRoleReason = "resigned"; return null; }
  const role = { level: LEVELS[d.level] ? d.level : "staff", orgId: d.orgId, employeeId: emp.id };
  await setDoc(ref, role);
  return role;
}

// ---------- 데이터 ----------
async function loadAll() {
  await loadOrgs();
  await loadEmployees();
}

async function loadOrgs() {
  const qs = await getDocs(collection(db, "orgs"));
  state.orgs = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  // 최고관리자 최초 진입 시 본사(hq) 자동 생성
  if (isSuper() && !state.orgs.some((o) => o.id === "hq")) {
    const hq = { name: "본사", type: "hq", order: 0, active: true };
    await setDoc(doc(db, "orgs", "hq"), { ...hq, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    state.orgs.push({ id: "hq", ...hq });
  }
  state.orgs.sort((a, b) =>
    ((a.type === "hq" ? 0 : 1) - (b.type === "hq" ? 0 : 1)) ||
    ((a.order ?? 999) - (b.order ?? 999)) ||
    String(a.name || "").localeCompare(String(b.name || ""), "ko"));
}

async function loadEmployees() {
  const col = collection(db, "employees");
  if (isSuper()) {
    const qs = await getDocs(col);
    state.employees = qs.docs.map(toEmp);
  } else if (isAdmin()) {
    const qs = await getDocs(query(col, where("orgId", "==", state.role.orgId)));
    state.employees = qs.docs.map(toEmp);
  } else {
    try {
      const s = await getDoc(doc(db, "employees", state.role.employeeId));
      state.employees = s.exists() ? [toEmp(s)] : [];
    } catch (e) {
      console.warn("내 직원 문서 읽기 실패", e);
      state.employees = [];
    }
  }
  state.employees.sort((a, b) => a.id.localeCompare(b.id));
  state.me = state.employees.find((e) => e.id === state.role.employeeId) || null;
}

// ---------- 내비게이션 ----------
function allowedNav() { return NAV.filter((n) => n.levels.includes(state.role.level)); }

function buildNav() {
  const nav = $("nav");
  nav.innerHTML = "";
  allowedNav().forEach((n) => {
    const b = document.createElement("button");
    b.className = "tab"; b.type = "button";
    b.dataset.view = n.id; b.textContent = n.label;
    b.onclick = () => { location.hash = "#" + n.id; };
    nav.appendChild(b);
  });
  nav.classList.remove("hidden");
  $("appSub").textContent = `${orgName(state.role.orgId)} · ${LEVELS[state.role.level] || state.role.level}`;
}

function route() {
  if (!state.role) return;
  const allowed = allowedNav();
  const hash = (location.hash || "").replace("#", "");
  const nav = allowed.find((n) => n.id === hash)
    || allowed.find((n) => n.id === (canManage() ? "dash" : "me"))
    || allowed[0];
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === nav.id));
  showView(nav.view);
  ({ dash: renderDash, employees: renderEmployees, orgs: renderOrgs, me: renderMe })[nav.id]();
}
window.addEventListener("hashchange", route);

// ---------- 대시보드 ----------
function renderDash() {
  const emps = state.employees;
  const cnt = (s) => emps.filter((e) => e.status === s).length;
  $("kpiTotal").textContent    = emps.length;
  $("kpiActive").textContent   = cnt("active");
  $("kpiLeave").textContent    = cnt("leave");
  $("kpiResigned").textContent = cnt("resigned");
  $("dashHint").textContent = isSuper() ? "전체 조직 기준" : `${orgName(state.role.orgId)} 기준`;

  const orgs = isSuper() ? state.orgs : state.orgs.filter((o) => o.id === state.role.orgId);
  const known = new Set(orgs.map((o) => o.id));
  const rows = orgs.map((o) => statRow(o.name, o.type, emps.filter((e) => e.orgId === o.id)));
  const orphan = emps.filter((e) => !known.has(e.orgId));
  if (orphan.length) rows.push(statRow("(조직 미지정)", null, orphan));
  $("tblOrgStats").innerHTML =
    `<thead><tr><th>조직</th><th class="num">재직</th><th class="num">휴직</th><th class="num">퇴직</th><th class="num">합계</th></tr></thead>` +
    `<tbody>${rows.join("") || `<tr><td colspan="5" class="empty">조직이 없습니다</td></tr>`}</tbody>` +
    (rows.length > 1
      ? `<tfoot><tr><td>합계</td><td class="num">${cnt("active")}</td><td class="num">${cnt("leave")}</td><td class="num">${cnt("resigned")}</td><td class="num">${emps.length}</td></tr></tfoot>`
      : "");

  const recent = [...emps]
    .sort((a, b) => (tsMillis(b.createdAt) - tsMillis(a.createdAt)) || b.id.localeCompare(a.id))
    .slice(0, 5);
  $("tblRecent").innerHTML = recent.length
    ? `<thead><tr><th>사번</th><th>이름</th><th>조직</th><th>직책</th><th>권한</th><th>상태</th><th>입사일</th></tr></thead><tbody>` +
      recent.map((e) => `<tr class="click" data-id="${esc(e.id)}">
          <td class="mono">${esc(e.id)}</td><td class="strong">${esc(e.name)}</td>
          <td>${esc(orgName(e.orgId))}</td><td>${esc(e.position || "—")}</td>
          <td>${levelBadge(e.level)}</td><td>${statusBadge(e.status)}</td>
          <td class="sub">${esc(fmtDate(e.joinedAt))}</td></tr>`).join("") + `</tbody>`
    : `<tbody><tr><td class="empty"><strong>등록된 직원이 없습니다</strong><a href="#employees">직원</a> 메뉴에서 첫 직원을 등록하세요.</td></tr></tbody>`;
  $("tblRecent").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => openEmp(tr.dataset.id)));
}
function statRow(name, type, list) {
  const c = (s) => list.filter((e) => e.status === s).length;
  return `<tr><td class="strong">${esc(name)}${type ? " " + orgTypeBadge(type) : ""}</td>
    <td class="num">${c("active")}</td><td class="num">${c("leave")}</td><td class="num">${c("resigned")}</td><td class="num">${list.length}</td></tr>`;
}

// ---------- 직원 ----------
function fillOrgSelect(sel, { all = false, onlyActive = false, ensure = "" } = {}) {
  const cur = sel.value;
  let orgs = state.orgs.filter((o) => !onlyActive || o.active !== false || o.id === ensure);
  let html = (all ? `<option value="">전체 조직</option>` : "") +
    orgs.map((o) => `<option value="${esc(o.id)}">${esc(o.name)}${o.active === false ? " (운영 중단)" : ""}</option>`).join("");
  if (ensure && !state.orgs.some((o) => o.id === ensure)) {
    html += `<option value="${esc(ensure)}">(알 수 없는 조직: ${esc(ensure)})</option>`;
  }
  sel.innerHTML = html;
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function renderEmployees() {
  const fo = $("fltOrg");
  fillOrgSelect(fo, { all: true });
  fo.disabled = !isSuper();
  if (!isSuper()) fo.value = state.role.orgId;
  const q  = $("fltQ").value.trim().toLowerCase();
  const org = fo.value;
  const st  = $("fltStatus").value;
  const list = state.employees.filter((e) =>
    (!org || e.orgId === org) && (!st || e.status === st) &&
    (!q || [e.name, e.email, e.id, e.position].some((v) => String(v || "").toLowerCase().includes(q))));
  $("empCount").textContent = `${list.length}명`;
  $("tblEmp").innerHTML = list.length
    ? `<thead><tr><th>사번</th><th>이름</th><th>조직</th><th>직책</th><th>권한</th><th>상태</th><th>입사일</th><th>이메일</th><th>연락처</th></tr></thead><tbody>` +
      list.map((e) => `<tr class="click" data-id="${esc(e.id)}">
          <td class="mono">${esc(e.id)}</td><td class="strong">${esc(e.name)}</td>
          <td>${esc(orgName(e.orgId))}</td><td>${esc(e.position || "—")}</td>
          <td>${levelBadge(e.level)}</td><td>${statusBadge(e.status)}</td>
          <td class="sub">${esc(fmtDate(e.joinedAt))}</td><td class="sub">${esc(e.email || "—")}</td>
          <td class="sub">${esc(e.phone || "—")}</td></tr>`).join("") + `</tbody>`
    : `<tbody><tr><td class="empty"><strong>직원이 없습니다</strong>${
        state.employees.length ? "검색 조건을 바꿔보세요." : "오른쪽 위 ‘직원 등록’으로 첫 직원을 등록하세요."
      }</td></tr></tbody>`;
  $("tblEmp").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => openEmp(tr.dataset.id)));
}
["fltQ", "fltOrg", "fltStatus"].forEach((id) => $(id).addEventListener("input", renderEmployees));

$("btnAddEmp").onclick   = () => openEmp(null);
$("btnEmpCancel").onclick = () => $("dlgEmp").close();
$("formEmp").addEventListener("input", () => { $("empErr").textContent = ""; });

function openEmp(id) {
  const emp = id ? state.employees.find((e) => e.id === id) : null;
  if (id && !emp) return;
  if (!canManage()) return;
  state.editing = emp;
  const self   = !!emp && emp.id === state.role.employeeId;
  const locked = !!emp && isAdmin() && emp.level === "super"; // 관리자는 최고관리자 정보 수정 불가

  $("dlgEmpTitle").textContent = emp ? (locked ? "직원 정보 (읽기 전용)" : "직원 정보 수정") : "직원 등록";
  $("dlgEmpId").textContent = emp ? emp.id : "사번은 자동으로 부여됩니다";

  const fOrg = $("fOrg");
  fillOrgSelect(fOrg, { onlyActive: !emp, ensure: emp?.orgId || "" });
  fOrg.value = emp ? emp.orgId : state.role.orgId;
  if (!fOrg.value && fOrg.options[0]) fOrg.value = fOrg.options[0].value;
  fOrg.disabled = isAdmin() || locked;

  const levels = Object.entries(LEVELS).filter(([k]) => isSuper() || k !== "super");
  $("fLevel").innerHTML = levels.map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("fLevel").value = emp && levels.some(([k]) => k === emp.level) ? emp.level : "staff";
  $("fLevel").disabled = self || locked;
  $("fLevelHelp").textContent = self ? "본인 권한은 변경할 수 없습니다" :
    (isSuper() ? "최고관리자: 전체 / 관리자: 소속 조직 / 직원: 본인 정보만" : "관리자: 소속 조직 / 직원: 본인 정보만");

  $("fName").value     = emp?.name || "";
  $("fEmail").value    = emp?.email || "";
  $("fPosition").value = emp?.position || "";
  $("fPhone").value    = emp?.phone || "";
  $("fJoined").value   = emp ? (emp.joinedAt || "") : todayStr();
  $("fStatus").value   = emp?.status && STATUS[emp.status] ? emp.status : "active";
  $("fStatus").disabled = self || locked;
  $("fMemo").value     = emp?.memo || "";
  ["fName", "fEmail", "fPosition", "fPhone", "fJoined", "fMemo"].forEach((i) => ($(i).disabled = locked));
  $("empErr").textContent = "";
  $("btnEmpSave").classList.toggle("hidden", locked);
  $("btnEmpDelete").classList.toggle("hidden", !(emp && isSuper() && !self));
  $("dlgEmp").showModal();
  if (!locked) $("fName").focus();
}

function validateEmp(d, emp) {
  if (!d.name) return "이름을 입력하세요.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "올바른 이메일을 입력하세요.";
  if (!d.orgId || !state.orgs.some((o) => o.id === d.orgId)) return "소속 조직을 선택하세요.";
  if (!LEVELS[d.level]) return "권한을 선택하세요.";
  if (!STATUS[d.status]) return "상태를 선택하세요.";
  if (isAdmin() && (d.orgId !== state.role.orgId || d.level === "super"))
    return "관리자는 소속 조직 내 직원만, 관리자 이하 권한으로 등록할 수 있습니다.";
  const dup = state.employees.find((e) => e.email === d.email && e.id !== emp?.id);
  if (dup) return `이미 등록된 이메일입니다 (${dup.id} ${dup.name}).`;
  return "";
}
function setEmpBusy(b) { ["btnEmpSave", "btnEmpDelete", "btnEmpCancel"].forEach((i) => ($(i).disabled = b)); }

$("formEmp").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const emp = state.editing;
  const data = {
    name:     $("fName").value.trim(),
    email:    $("fEmail").value.trim().toLowerCase(),
    orgId:    $("fOrg").value,
    level:    $("fLevel").value,
    position: $("fPosition").value.trim(),
    phone:    $("fPhone").value.trim(),
    joinedAt: $("fJoined").value,
    status:   $("fStatus").value,
    memo:     $("fMemo").value.trim(),
  };
  const err = validateEmp(data, emp);
  if (err) { $("empErr").textContent = err; return; }
  setEmpBusy(true);
  try {
    if (!emp) {
      const id = await nextEmployeeId();
      await setDoc(doc(db, "employees", id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      toast(`${data.name} 님을 등록했습니다 (${id})`);
    } else {
      await updateDoc(doc(db, "employees", emp.id), { ...data, updatedAt: serverTimestamp() });
      if (emp.level !== data.level || emp.orgId !== data.orgId || emp.status !== data.status) {
        await syncRoles(emp.id, data);
      }
      toast("저장했습니다");
    }
    $("dlgEmp").close();
    await loadEmployees();
    route();
  } catch (e) {
    console.error(e);
    $("empErr").textContent = errMsg(e);
  } finally {
    setEmpBusy(false);
  }
});

$("btnEmpDelete").onclick = async () => {
  const emp = state.editing;
  if (!emp || !isSuper()) return;
  const ok = confirm(`${emp.name} (${emp.id}) 직원 정보를 삭제할까요?\n삭제하면 이 계정의 로그인 권한도 함께 제거됩니다.\n기록을 남기려면 삭제 대신 상태를 ‘퇴직’으로 바꾸세요.`);
  if (!ok) return;
  setEmpBusy(true);
  try {
    await syncRoles(emp.id, { status: "resigned" }); // 연결된 roles 삭제
    await deleteDoc(doc(db, "employees", emp.id));
    toast("삭제했습니다");
    $("dlgEmp").close();
    await loadEmployees();
    route();
  } catch (e) {
    console.error(e);
    $("empErr").textContent = errMsg(e);
  } finally {
    setEmpBusy(false);
  }
};

// 사번 자동 부여: meta/counters.employee 를 트랜잭션으로 증가
async function nextEmployeeId() {
  const known = state.employees.reduce((m, e) => {
    const n = /^emp_(\d+)$/.exec(e.id);
    return n ? Math.max(m, parseInt(n[1], 10)) : m;
  }, 1);
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "meta", "counters");
    const snap = await tx.get(ref);
    let n = Math.max(snap.exists() ? Number(snap.data().employee || 0) : 0, known);
    let id = "";
    for (let i = 0; i < 20; i++) {
      n += 1;
      id = "emp_" + String(n).padStart(4, "0");
      if (!isSuper()) break; // 관리자는 다른 조직 문서를 읽을 수 없어 카운터만 신뢰
      const ex = await tx.get(doc(db, "employees", id));
      if (!ex.exists()) break;
    }
    tx.set(ref, { employee: n }, { merge: true });
    return id;
  });
}

// 직원 정보 변경 → 연결된 roles 동기화 (퇴직이면 권한 제거)
async function syncRoles(employeeId, data) {
  const col = collection(db, "roles");
  const q = isSuper()
    ? query(col, where("employeeId", "==", employeeId))
    : query(col, where("employeeId", "==", employeeId), where("orgId", "==", state.role.orgId));
  const qs = await getDocs(q);
  await Promise.all(qs.docs.map((d) =>
    data.status === "resigned"
      ? deleteDoc(d.ref)
      : updateDoc(d.ref, { level: data.level, orgId: data.orgId })));
}

// ---------- 조직 ----------
function renderOrgs() {
  $("btnAddOrg").classList.toggle("hidden", !isSuper());
  const rows = state.orgs.map((o) => {
    const mine = isSuper() || o.id === state.role.orgId;
    const active = state.employees.filter((e) => e.orgId === o.id && e.status === "active").length;
    return `<tr class="${isSuper() ? "click" : ""}" data-id="${esc(o.id)}">
      <td class="mono">${esc(o.id)}</td><td class="strong">${esc(o.name)}</td>
      <td>${orgTypeBadge(o.type)}</td>
      <td class="num">${canManage() && mine ? active : "—"}</td>
      <td>${o.active === false ? badge("off", "운영 중단") : badge("s-active", "운영 중")}</td></tr>`;
  });
  $("tblOrgs").innerHTML =
    `<thead><tr><th>조직 ID</th><th>이름</th><th>구분</th><th class="num">재직 인원</th><th>상태</th></tr></thead>` +
    `<tbody>${rows.join("") || `<tr><td colspan="5" class="empty">조직이 없습니다</td></tr>`}</tbody>`;
  if (isSuper()) $("tblOrgs").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => openOrg(tr.dataset.id)));
}

$("btnAddOrg").onclick    = () => openOrg(null);
$("btnOrgCancel").onclick = () => $("dlgOrg").close();
$("formOrg").addEventListener("input", () => { $("orgErr").textContent = ""; });

function openOrg(id) {
  if (!isSuper()) return;
  const org = id ? state.orgs.find((o) => o.id === id) : null;
  if (id && !org) return;
  state.editingOrg = org;
  $("dlgOrgTitle").textContent = org ? "조직 수정" : "조직 추가";
  $("fOrgId").value = org?.id || "";
  $("fOrgId").disabled = !!org;
  $("fOrgName").value = org?.name || "";
  $("fOrgType").value = org?.type && ORG_TYPES[org.type] ? org.type : "branch";
  $("fOrgOrder").value = org ? (org.order ?? "") : state.orgs.length;
  $("fOrgActive").checked = org ? org.active !== false : true;
  const isHq = org?.id === "hq";
  $("fOrgType").disabled = isHq;
  $("fOrgActive").disabled = isHq;
  $("orgErr").textContent = "";
  $("dlgOrg").showModal();
  (org ? $("fOrgName") : $("fOrgId")).focus();
}

$("formOrg").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const org = state.editingOrg;
  const id = org ? org.id : $("fOrgId").value.trim().toLowerCase();
  const data = {
    name:   $("fOrgName").value.trim(),
    type:   $("fOrgType").value,
    order:  Number($("fOrgOrder").value) || 0,
    active: $("fOrgActive").checked,
  };
  const fail = (m) => { $("orgErr").textContent = m; };
  if (!org && !/^[a-z0-9][a-z0-9_-]{1,29}$/.test(id))
    return fail("조직 ID는 영문 소문자·숫자·-·_ 로 2~30자여야 합니다 (예: anyang, hq).");
  if (!org && state.orgs.some((o) => o.id === id)) return fail("이미 있는 조직 ID입니다.");
  if (!data.name) return fail("조직 이름을 입력하세요.");
  if (!ORG_TYPES[data.type]) return fail("구분을 선택하세요.");
  $("btnOrgSave").disabled = true;
  try {
    if (org) await updateDoc(doc(db, "orgs", id), { ...data, updatedAt: serverTimestamp() });
    else await setDoc(doc(db, "orgs", id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    toast("저장했습니다");
    $("dlgOrg").close();
    await loadOrgs();
    buildNav();
    route();
  } catch (e) {
    console.error(e);
    fail(errMsg(e));
  } finally {
    $("btnOrgSave").disabled = false;
  }
});

// ---------- 내 정보 ----------
function renderMe() {
  const me = state.me, r = state.role, body = $("meBody");
  if (me) {
    body.innerHTML = `<div class="card">
      <h2>${esc(me.name)} <span class="mono" style="font-size:13px;color:var(--text-sub);font-weight:500">${esc(me.id)}</span></h2>
      <dl class="dl">
        <dt>이메일</dt><dd>${esc(me.email || state.user.email || "—")}</dd>
        <dt>소속</dt><dd>${esc(orgName(me.orgId))}</dd>
        <dt>직책</dt><dd>${esc(me.position || "—")}</dd>
        <dt>권한</dt><dd>${levelBadge(r.level)}</dd>
        <dt>상태</dt><dd>${statusBadge(me.status)}</dd>
        <dt>입사일</dt><dd>${esc(fmtDate(me.joinedAt))}</dd>
        <dt>연락처</dt><dd>${esc(me.phone || "—")}</dd>
      </dl>
      <p class="msg" style="margin-top:16px">${
        canManage() ? "정보 수정은 <a href=\"#employees\">직원</a> 메뉴에서 할 수 있습니다." : "정보 변경이 필요하면 관리자에게 요청하세요."
      }</p></div>`;
    return;
  }
  if (isSuper()) {
    body.innerHTML = `<div class="card">
      <h2>내 직원 정보 등록</h2>
      <p>권한(<span class="mono">${esc(r.employeeId)}</span>)은 등록돼 있지만 직원 정보가 아직 없습니다. 아래 정보를 입력해 등록하세요.</p>
      <form id="formMe" novalidate>
        <div class="dlg-body" style="padding:0">
          <div class="field"><label for="fMeName">이름<span class="req">*</span></label><input class="input" id="fMeName" maxlength="40"></div>
          <div class="field"><label for="fMePosition">직책</label><input class="input" id="fMePosition" maxlength="30" placeholder="예: 대표, 원장"></div>
          <div class="field"><label for="fMePhone">연락처</label><input class="input" id="fMePhone" type="tel" maxlength="20" placeholder="010-0000-0000"></div>
          <div class="field"><label for="fMeJoined">입사일</label><input class="input" id="fMeJoined" type="date"></div>
          <div class="field"><label>소속 조직</label><input class="input" value="${esc(orgName(r.orgId))}" disabled></div>
          <div class="field"><label>이메일</label><input class="input" value="${esc(state.user.email || "")}" disabled></div>
          <div class="msg error dlg-err" id="meErr"></div>
        </div>
        <div style="margin-top:16px"><button class="btn btn-primary" type="submit" id="btnMeSave">등록</button></div>
      </form></div>`;
    $("formMe").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const name = $("fMeName").value.trim();
      if (!name) { $("meErr").textContent = "이름을 입력하세요."; return; }
      if (!state.orgs.some((o) => o.id === r.orgId)) {
        $("meErr").textContent = `조직 ‘${r.orgId}’ 이(가) 없습니다. 조직 메뉴에서 먼저 만들어주세요.`;
        return;
      }
      $("btnMeSave").disabled = true;
      try {
        await setDoc(doc(db, "employees", r.employeeId), {
          name, email: (state.user.email || "").toLowerCase(), orgId: r.orgId, level: r.level,
          position: $("fMePosition").value.trim(), phone: $("fMePhone").value.trim(),
          joinedAt: $("fMeJoined").value, status: "active", memo: "",
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        toast("등록했습니다");
        await loadEmployees();
        route();
      } catch (e) {
        console.error(e);
        $("meErr").textContent = errMsg(e);
      } finally {
        const b = $("btnMeSave"); // 성공 시 화면이 다시 그려져 버튼이 없을 수 있음
        if (b) b.disabled = false;
      }
    });
    return;
  }
  body.innerHTML = `<div class="card">
    <h2>직원 정보를 찾을 수 없습니다</h2>
    <p>권한은 있지만 연결된 직원 정보(<span class="mono">${esc(r.employeeId)}</span>)를 읽을 수 없습니다. 이메일이 바뀌었거나 정보가 삭제된 경우입니다. 관리자에게 문의하세요.</p></div>`;
}
