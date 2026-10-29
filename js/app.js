// 자라다 People — 메인 앱 (로그인 → 권한 확인 → 대시보드/직원/조직/내 정보/직원 상세)
import { auth, db } from "./firebase.js";
import {
  GoogleAuthProvider, signInWithPopup, signInAnonymously, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, limit, runTransaction, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  $, LEVELS, ORG_LEVELS, STATUS, ORG_TYPES, state, isSuper, isHR, isAdmin, isMgr, canManage, canApprove, can, esc, toast, errMsg,
  orgName, orgNames, badge, statusBadge, levelBadge, orgTypeBadge, branchTags, fmtDate, todayStr,
  tsMillis, toEmp, renderOrgChecks, readOrgChecks, syncRoles, audit
} from "./core.js";
import { CORPS, corpName, corpFromText } from "./company.js";
import { birthFromRrn } from "./rrn.js";
import { initDetail, renderDetail, renderMyDocs, bindCertModal, deleteEmployeeData } from "./detail.js";
import { initLeave, loadLeaves, loadEvents, renderLeaves, pendingCount } from "./leave.js";
import { initAdmin, renderAdmin } from "./admin.js";
import { exportEmployees } from "./export.js";
import { renderTodo } from "./todo.js";
import { renderCharts, renderOrgChart } from "./charts.js";
import { initPayslips, loadMyPayslips, renderMyPayslips, unseenSlips } from "./payslips.js";
import { initNotices, loadNotices, renderNotices, unreadCount } from "./notices.js";
import { addAssignments, diffEmployee } from "./records.js";
import { initCalendar, renderCalendar } from "./calendar.js";

const NAV = [
  { id: "notices",   label: "공지",     view: "Notices",   levels: Object.keys(LEVELS) },
  { id: "dash",      label: "대시보드", view: "Dash",      levels: ["super", "hr", "admin", "principal"] },
  { id: "calendar",  label: "달력",     view: "Calendar",  levels: Object.keys(LEVELS) },
  { id: "leaves",    label: "휴가",     view: "Leaves",    levels: Object.keys(LEVELS) },
  { id: "payslips",  label: "내 급여", view: "Payslips",  levels: Object.keys(LEVELS) },
  { id: "employees", label: "직원",     view: "Employees", levels: ["super", "hr", "admin", "principal"] },
  { id: "admin",     label: "관리",     view: "Admin",     levels: ["super", "hr", "admin", "principal"] },
  { id: "orgs",      label: "조직",     view: "Orgs",      levels: Object.keys(LEVELS) },
  { id: "me",        label: "내 정보",  view: "Me",        levels: Object.keys(LEVELS) },
  { id: "docs",      label: "내 서류",  view: "Docs",      levels: Object.keys(LEVELS) },
];
const VIEWS = ["Login", "Loading", "NoRole", "Dash", "Calendar", "Leaves", "Notices", "Payslips", "Employees", "Orgs", "Admin", "Me", "Docs", "Detail"];
function showView(name) {
  VIEWS.forEach((v) => $("view" + v).classList.toggle("hidden", v !== name));
}

// 등록 링크: ?self=사번&t=토큰
const SELF = (() => {
  const p = new URLSearchParams(location.search);
  return { id: p.get("self") || "", token: p.get("t") || "" };
})();
const hasSelfLink = !!(SELF.id && SELF.token);

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
  if (user?.isAnonymous && !hasSelfLink) { signOut(auth); return; }     // 등록 링크 없이 남은 익명 세션 정리
  if (!user && hasSelfLink) {
    state.selfMode = true;
    showView("Loading"); $("loadingMsg").textContent = "접속 중…";
    signInAnonymously(auth).catch((e) => {
      $("loadingMsg").innerHTML = `<span class="msg error" style="margin:0">접속 실패: ${esc(e.code || e.message)}<br>Authentication 에서 ‘익명’ 로그인이 켜져 있는지 확인하세요.</span>`;
    });
    return;
  }
  state.user = user;
  if (!user) { state.selfMode = false; resetApp(); return; }
  state.selfMode = !!user.isAnonymous;
  $("topWho").textContent = user.isAnonymous ? "등록 링크로 접속" : (user.email || user.uid);
  $("btnLogout").classList.toggle("hidden", !!user.isAnonymous);
  document.body.classList.toggle("self-mode", state.selfMode);
  enter(user);
});

function resetApp() {
  state.role = null; state.orgs = []; state.employees = []; state.me = null;
  $("topWho").textContent = "로그인 안 됨";
  $("appSub").textContent = "통합 HR";
  $("nav").classList.add("hidden"); $("nav").innerHTML = "";
  $("btnLogout").classList.add("hidden");
  document.body.classList.remove("self-mode");
  showView("Login");
}

async function enter(user) {
  showView("Loading");
  $("loadingMsg").textContent = "권한 확인 중…";
  $("btnReload").classList.add("hidden");
  $("nav").classList.add("hidden");
  try {
    const role = await resolveRole(user);
    if (state.noRoleReason === "switch") { await signOut(auth); return; }   // 다른 직원의 링크로 새로 들어옴
    if (!role) {
      const email = esc(user.email || "(이메일 없음)");
      $("noRoleNotice").classList.toggle("hidden", state.selfMode);
      $("btnLogout2").classList.toggle("hidden", state.selfMode);
      if (state.noRoleReason === "badlink") {
        $("noRoleTitle").textContent = "등록 링크가 올바르지 않습니다";
        $("noRoleMsg").innerHTML = "링크가 잘못됐거나 직원 정보가 변경됐습니다. 담당 관리자에게 새 링크를 요청하세요.";
      } else if (state.noRoleReason === "resigned") {
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
    if (state.selfMode) { $("appSub").textContent = "인사정보 등록"; $("nav").classList.add("hidden"); }
    else buildNav();
    route();
  } catch (e) {
    console.error(e);
    $("loadingMsg").innerHTML = `<span class="msg error" style="margin:0">${esc(errMsg(e))}</span>`;
    $("btnReload").classList.remove("hidden");
  }
}

// roles/{uid} 조회. 없으면 (1) 등록 링크 토큰 (2) 이메일이 일치하는 직원 문서로 셀프 등록
async function resolveRole(user) {
  state.noRoleReason = "";
  const ref = doc(db, "roles", user.uid);
  const snap = await getDoc(ref);

  if (user.isAnonymous) {
    if (snap.exists()) {
      if (snap.data().employeeId === SELF.id) return snap.data();
      state.noRoleReason = "switch"; return null;
    }
    const role = { level: "staff", employeeId: SELF.id, selfToken: SELF.token };
    try { await setDoc(ref, role); return role; }
    catch (e) { console.warn("등록 링크 확인 실패", e.code || e); state.noRoleReason = "badlink"; return null; }
  }

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
async function loadSettings() {
  try { const s = await getDoc(doc(db, "settings", "app")); state.settings = s.exists() ? s.data() : {}; }
  catch (e) { state.settings = {}; }
  try { const p = await getDoc(doc(db, "settings", "permissions")); state.perms = p.exists() ? p.data() : {}; }
  catch (e) { state.perms = {}; }
}

async function loadAll() {
  await loadSettings();
  await loadOrgs();
  await loadEmployees();
  await Promise.all([loadLeaves().catch((e) => console.warn("휴가 불러오기 실패", e.code || e)), loadEvents(), loadNotices(), loadMyPayslips()]);
}

async function loadOrgs() {
  const qs = await getDocs(collection(db, "orgs"));
  state.orgs = qs.docs.map((d) => ({ id: d.id, ...d.data() }));
  // 최고관리자 최초 진입 시 본사(hq) 자동 생성
  if (isHR() && !state.orgs.some((o) => o.id === "hq")) {
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
  if (isHR()) {
    const qs = await getDocs(col);
    state.employees = qs.docs.map(toEmp);
  } else if (isMgr()) {
    const org = state.role.orgId;
    const [a, b] = await Promise.all([
      getDocs(query(col, where("orgId", "==", org))),
      getDocs(query(col, where("orgIds", "array-contains", org))),
    ]);
    const byId = new Map();
    [...a.docs, ...b.docs].forEach((d) => byId.set(d.id, toEmp(d)));
    state.employees = [...byId.values()];
  } else {
    try {
      const s = await getDoc(doc(db, "employees", state.role.employeeId));
      state.employees = s.exists() ? [toEmp(s)] : [];
    } catch (e) {
      console.warn("내 직원 문서 읽기 실패", e);
      state.employees = [];
    }
  }
  state.trash = state.employees.filter((e) => e.deleted);                 // 휴지통(소프트 삭제)
  state.employees = state.employees.filter((e) => !e.deleted).sort((a, b) => a.id.localeCompare(b.id));
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

function updateBadges() {
  const n = pendingCount();
  document.querySelectorAll('.tab[data-view="leaves"]').forEach((t) => { t.innerHTML = `휴가${n ? ` <span class="tab-badge">${n}</span>` : ""}`; });
  const sl = unseenSlips();
  document.querySelectorAll('.tab[data-view="payslips"]').forEach((t) => { t.innerHTML = `내 급여${sl ? ` <span class="tab-badge">${sl}</span>` : ""}`; });
  const u = unreadCount();
  document.querySelectorAll('.tab[data-view="notices"]').forEach((t) => { t.innerHTML = `공지${u ? ` <span class="tab-badge">${u}</span>` : ""}`; });
}

// 로그인한 구글 계정의 이메일과, 권한(roles)에 연결된 직원의 이메일이 다르면 알린다 (연결이 잘못된 경우)
function renderLinkWarn() {
  const el = $("linkWarn"), mail = (state.user?.email || "").toLowerCase();
  const mine = state.me, other = mail && state.employees.find((e) => (e.email || "").toLowerCase() === mail && e.id !== mine?.id);
  if (state.selfMode || !state.user || state.user.isAnonymous || !mine || !other || (mine.email || "").toLowerCase() === mail) { el.classList.add("hidden"); return; }
  el.classList.remove("hidden");
  el.innerHTML = `⚠ 로그인한 계정(<b>${esc(mail)}</b>)은 <b>${esc(other.name)}</b>(${esc(other.id)}) 직원의 이메일인데, 이 계정의 권한은 <b>${esc(mine.name)}</b>(${esc(mine.id)})에 연결돼 있어 ‘내 정보’에 ${esc(mine.name)} 님이 나옵니다.
    ${isSuper() ? `<button class="btn btn-primary btn-sm" id="btnRelink">내 계정을 ${esc(other.name)}(${esc(other.id)})에 연결</button>` : "최고관리자에게 연결을 바꿔 달라고 요청하세요."}`;
  $("btnRelink")?.addEventListener("click", async () => {
    if (!confirm(`이 계정을 ${other.name}(${other.id}) 직원에 연결합니다. 권한 등급은 그대로(${LEVELS[state.role.level]}) 유지되고 소속은 ${orgName(other.orgId)}로 바뀝니다. 계속할까요?`)) return;
    try {
      await updateDoc(doc(db, "roles", state.user.uid), { employeeId: other.id, orgId: other.orgId });
      audit("role_relink", { targetEmployeeId: other.id, detail: `${mine.id} → ${other.id}` });
      toast("연결을 바꿨습니다. 새로고침합니다"); setTimeout(() => location.reload(), 800);
    } catch (e) { console.error(e); toast(errMsg(e), true); }
  });
}

function route() {
  if (!state.role) return;
  renderLinkWarn();
  if (state.selfMode) { showView("Detail"); renderDetail(state.role.employeeId); return; }
  const allowed = allowedNav();
  const hash = (location.hash || "").replace("#", "");
  let navId = "";
  if (hash.startsWith("emp/")) {
    const id = decodeURIComponent(hash.slice(4));
    if (canManage() || id === state.role.employeeId) {
      navId = canManage() ? "employees" : "me";
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === navId));
      showView("Detail"); renderDetail(id);
      return;
    }
  }
  const nav = allowed.find((n) => n.id === hash)
    || allowed.find((n) => n.id === (canManage() ? "dash" : "me"))
    || allowed[0];
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === nav.id));
  showView(nav.view);
  ({ dash: renderDash, calendar: renderCalendar, leaves: renderLeaves, notices: renderNotices, payslips: renderMyPayslips, employees: () => renderEmployees(), orgs: renderOrgs, admin: renderAdmin, me: renderMe, docs: renderDocs })[nav.id]();
  updateBadges();
}
window.addEventListener("hashchange", route);

// ---------- 대시보드 ----------
function renderDash() {
  renderTodo($("dashTodo"));
  const emps = state.employees;
  const cnt = (s) => emps.filter((e) => e.status === s).length;
  $("kpiTotal").textContent    = emps.length;
  $("kpiActive").textContent   = cnt("active");
  $("kpiLeave").textContent    = cnt("leave");
  $("kpiResigned").textContent = cnt("resigned");
  renderCharts($("dashCharts"), emps.filter((e) => !e.deleted), isHR() ? state.orgs : state.orgs.filter((o) => o.id === state.role.orgId), isHR());
  $("dashHint").textContent = isHR() ? "전체 조직 기준" : `${orgName(state.role.orgId)} 기준`;

  const orgs = isHR() ? state.orgs : state.orgs.filter((o) => o.id === state.role.orgId);
  const known = new Set(orgs.map((o) => o.id));
  const rows = orgs.map((o) => statRow(o.name, o.type, emps.filter((e) => e.orgIds.includes(o.id))));
  const orphan = emps.filter((e) => !e.orgIds.some((id) => known.has(id)));
  if (orphan.length) rows.push(statRow("(조직 미지정)", null, orphan));
  $("tblOrgStats").innerHTML =
    `<thead><tr><th>조직</th><th class="num">재직</th><th class="num">휴직</th><th class="num">퇴직</th><th class="num">합계</th></tr></thead>` +
    `<tbody>${rows.join("") || `<tr><td colspan="5" class="empty">조직이 없습니다</td></tr>`}</tbody>` +
    (rows.length > 1
      ? `<tfoot><tr><td>합계 (중복 제외)</td><td class="num">${cnt("active")}</td><td class="num">${cnt("leave")}</td><td class="num">${cnt("resigned")}</td><td class="num">${emps.length}</td></tr></tfoot>`
      : "");

  const recent = [...emps]
    .sort((a, b) => (tsMillis(b.createdAt) - tsMillis(a.createdAt)) || b.id.localeCompare(a.id))
    .slice(0, 5);
  $("tblRecent").innerHTML = recent.length
    ? `<thead><tr><th>사번</th><th>이름</th><th>조직</th><th>직책</th><th>권한</th><th>상태</th><th>입사일</th></tr></thead><tbody>` +
      recent.map((e) => `<tr class="click" data-id="${esc(e.id)}">
          <td class="mono">${esc(e.id)}</td><td class="strong">${esc(e.name)}</td>
          <td>${branchTags(e.orgIds)}</td><td>${esc(e.position || "—")}</td>
          <td>${levelBadge(e.level)}</td><td>${statusBadge(e.status)}</td>
          <td class="sub">${esc(fmtDate(e.joinedAt))}</td></tr>`).join("") + `</tbody>`
    : `<tbody><tr><td class="empty"><strong>등록된 직원이 없습니다</strong><a href="#employees">직원</a> 메뉴에서 첫 직원을 등록하세요.</td></tr></tbody>`;
  $("tblRecent").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => { location.hash = "#emp/" + tr.dataset.id; }));
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

let lastList = [];
// 목록 보기 설정: 정렬·열·쪽·선택 (열 설정은 이 브라우저에만 저장)
const LIST_COLS = [
  { k: "id", l: "사번", on: true, cls: "mono", v: (e) => esc(e.id), s: (e) => e.id },
  { k: "name", l: "이름", fixed: true, cls: "strong", v: (e) => esc(e.name), s: (e) => e.name },
  { k: "orgs", l: "조직", fixed: true, v: (e) => branchTags(e.orgIds), s: (e) => orgNames(e.orgIds) },
  { k: "corp", l: "소속 법인", on: true, v: (e) => esc(corpName(e.corp) || "—"), s: (e) => corpName(e.corp) },
  { k: "position", l: "직책", on: true, v: (e) => esc(e.position || "—"), s: (e) => e.position || "" },
  { k: "level", l: "권한", on: true, v: (e) => levelBadge(e.level), s: (e) => e.level },
  { k: "status", l: "상태", fixed: true, v: (e) => statusBadge(e.status), s: (e) => e.status },
  { k: "joinedAt", l: "입사일", on: true, cls: "sub", v: (e) => esc(fmtDate(e.joinedAt)), s: (e) => e.joinedAt || "" },
  { k: "email", l: "이메일", on: true, cls: "sub", v: (e) => esc(e.email || "—"), s: (e) => e.email || "" },
  { k: "phone", l: "연락처", on: true, cls: "sub", v: (e) => esc(e.phone || "—"), s: (e) => e.phone || "" },
  { k: "birthDate", l: "생년월일", cls: "sub", v: (e) => esc(fmtDate(e.birthDate)), s: (e) => e.birthDate || "" },
  { k: "contractEndDate", l: "계약 만료일", cls: "sub", v: (e) => esc(fmtDate(e.contractEndDate)), s: (e) => e.contractEndDate || "" },
  { k: "probationEndDate", l: "수습 종료일", cls: "sub", v: (e) => esc(fmtDate(e.probationEndDate)), s: (e) => e.probationEndDate || "" },
];
const PAGE_SIZE = 50;
const lv = { sort: { k: "", dir: 1 }, page: 1, sel: new Set(), cols: null };
function listCols() {
  if (!lv.cols) {
    let saved = null; try { saved = JSON.parse(localStorage.getItem("jarada.listCols") || "null"); } catch {}
    lv.cols = new Set(LIST_COLS.filter((c) => c.fixed || (saved ? saved.includes(c.k) : c.on)).map((c) => c.k));
  }
  return LIST_COLS.filter((c) => lv.cols.has(c.k));
}
function renderEmployees(keepPage) {
  const fo = $("fltOrg");
  fillOrgSelect(fo, { all: true });
  fo.disabled = !isHR();
  if (!isHR()) fo.value = state.role.orgId;
  const q  = $("fltQ").value.trim().toLowerCase();
  const org = fo.value;
  const st  = $("fltStatus").value;
  const list = state.employees.filter((e) =>
    (!org || e.orgIds.includes(org)) && (!st || e.status === st) &&
    (!q || [e.name, e.email, e.id, e.position].some((v) => String(v || "").toLowerCase().includes(q))));
  const col = LIST_COLS.find((c) => c.k === lv.sort.k);
  if (col) list.sort((a, b) => String(col.s(a)).localeCompare(String(col.s(b)), "ko") * lv.sort.dir || a.id.localeCompare(b.id));
  lastList = list;
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  if (!keepPage) lv.page = 1;
  lv.page = Math.min(Math.max(1, lv.page), pages);
  const view = list.slice((lv.page - 1) * PAGE_SIZE, lv.page * PAGE_SIZE);
  const cols = listCols(), bulk = isHR() && can("empWrite");
  $("btnAddEmp").classList.toggle("hidden", !can("empWrite")); $("btnBulk").classList.toggle("hidden", !can("empWrite"));
  $("empCount").textContent = `${list.length}명`;
  $("tblEmp").innerHTML = list.length
    ? `<thead><tr>${bulk ? `<th style="width:34px"><input type="checkbox" id="selAll" title="이 쪽 전체 선택" ${view.length && view.every((e) => lv.sel.has(e.id)) ? "checked" : ""}></th>` : ""}${cols.map((c) =>
        `<th class="sortable" data-sort="${c.k}">${c.l}${lv.sort.k === c.k ? (lv.sort.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead><tbody>` +
      view.map((e) => `<tr class="click" data-id="${esc(e.id)}">${bulk ? `<td><input type="checkbox" data-sel="${esc(e.id)}" ${lv.sel.has(e.id) ? "checked" : ""}></td>` : ""}${cols.map((c) => `<td class="${c.cls || ""}">${c.v(e)}</td>`).join("")}</tr>`).join("") + `</tbody>`
    : `<tbody><tr><td class="empty"><strong>직원이 없습니다</strong>${
        state.employees.length ? "검색 조건을 바꿔보세요." : "오른쪽 위 ‘직원 등록’으로 첫 직원을 등록하세요."
      }</td></tr></tbody>`;
  $("tblEmp").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = (ev) => { if (ev.target.closest("input")) return; location.hash = "#emp/" + tr.dataset.id; }));
  $("tblEmp").querySelectorAll("[data-sort]").forEach((th) => (th.onclick = () => {
    lv.sort = lv.sort.k === th.dataset.sort ? { k: th.dataset.sort, dir: -lv.sort.dir } : { k: th.dataset.sort, dir: 1 }; renderEmployees();
  }));
  $("tblEmp").querySelectorAll("[data-sel]").forEach((cb) => (cb.onchange = () => { cb.checked ? lv.sel.add(cb.dataset.sel) : lv.sel.delete(cb.dataset.sel); renderBulkBar(); }));
  const all = $("selAll"); if (all) all.onchange = () => { view.forEach((e) => (all.checked ? lv.sel.add(e.id) : lv.sel.delete(e.id))); renderEmployees(true); };
  $("empPager").innerHTML = pages > 1 ? `<button class="btn btn-secondary btn-sm" id="pgPrev" ${lv.page <= 1 ? "disabled" : ""}>이전</button><span>${lv.page} / ${pages}쪽</span><button class="btn btn-secondary btn-sm" id="pgNext" ${lv.page >= pages ? "disabled" : ""}>다음</button>` : "";
  if (pages > 1) { $("pgPrev").onclick = () => { lv.page--; renderEmployees(true); }; $("pgNext").onclick = () => { lv.page++; renderEmployees(true); }; }
  renderBulkBar();
}
function renderBulkBar() {
  const bar = $("empBulkBar"); const ids = [...lv.sel].filter((id) => state.employees.some((e) => e.id === id));
  lv.sel = new Set(ids);
  if (!(isHR() && can("empWrite")) || !ids.length) { bar.classList.add("hidden"); return; }
  $("bulkTrash").classList.toggle("hidden", !can("trash"));
  bar.classList.remove("hidden");
  $("bulkCount").textContent = `${ids.length}명 선택`;
  fillOrgSelect($("bulkOrg"), { onlyActive: true });
}
$("bulkClear").onclick = () => { lv.sel.clear(); renderEmployees(true); };
$("bulkStatusGo").onclick = () => bulkChange({ status: $("bulkStatus").value }, `상태를 ‘${STATUS[$("bulkStatus").value]}’(으)로 바꿉니다.`);
$("bulkOrgGo").onclick = () => bulkChange({ addOrg: $("bulkOrg").value }, `‘${orgName($("bulkOrg").value)}’ 지점을 소속에 추가합니다.`);
$("bulkOrgMove").onclick = () => bulkChange({ moveOrg: $("bulkOrg").value }, `소속을 ‘${orgName($("bulkOrg").value)}’ 한 곳으로 바꿉니다.`);
async function bulkChange(op, desc) {
  const targets = state.employees.filter((e) => lv.sel.has(e.id));
  if (!targets.length || !isHR() || !can("empWrite")) return;
  if (op.status === "resigned" && !confirm("퇴직으로 바꾸면 이 직원들의 로그인 권한이 제거됩니다.")) return;
  if (!confirm(`${targets.length}명에 대해 ${desc} 계속할까요?`)) return;
  let ok = 0, fail = 0;
  for (const e of targets) {
    try {
      const patch = { updatedAt: serverTimestamp() }; const after = { ...e };
      if (op.status) { patch.status = op.status; after.status = op.status; }
      if (op.addOrg && !e.orgIds.includes(op.addOrg)) { after.orgIds = [...e.orgIds, op.addOrg]; }
      if (op.moveOrg) { after.orgIds = [op.moveOrg]; after.orgId = op.moveOrg; }
      if (after.orgIds !== e.orgIds) { patch.orgIds = after.orgIds; patch.orgId = after.orgIds[0]; after.orgId = after.orgIds[0]; }
      if (Object.keys(patch).length === 1) continue;
      await updateDoc(doc(db, "employees", e.id), patch);
      if (e.orgId !== after.orgId || e.status !== after.status) await syncRoles(e.id, after);
      const changes = diffEmployee(e, after, STATUS, LEVELS);
      if (changes.length) await addAssignments({ ...e, orgId: after.orgId }, changes);
      ok++;
    } catch (err) { console.warn(err); fail++; }
  }
  audit("emp_bulk_change", { detail: `${desc} 성공 ${ok} · 실패 ${fail}` });
  toast(`${ok}명 변경${fail ? `, ${fail}명 실패` : ""}`, !!fail);
  lv.sel.clear(); await loadEmployees(); renderEmployees(true);
}
$("btnListCols").onclick = () => {
  $("colList").innerHTML = LIST_COLS.map((c) => `<label class="chk"><input type="checkbox" value="${c.k}" ${lv.cols.has(c.k) ? "checked" : ""} ${c.fixed ? "disabled" : ""}> ${c.l}</label>`).join("");
  $("dlgCols").showModal();
};
$("btnColsDone").onclick = () => {
  lv.cols = new Set(LIST_COLS.filter((c) => c.fixed || $("colList").querySelector(`input[value="${c.k}"]`).checked).map((c) => c.k));
  try { localStorage.setItem("jarada.listCols", JSON.stringify([...lv.cols])); } catch {}
  $("dlgCols").close(); renderEmployees(true);
};
["fltQ", "fltOrg", "fltStatus"].forEach((id) => $(id).addEventListener("input", () => renderEmployees()));

$("btnAddEmp").onclick   = () => openEmp(null);
$("btnExportList").onclick = () => exportEmployees(lastList);
$("btnEmpCancel").onclick = () => $("dlgEmp").close();
$("formEmp").addEventListener("input", () => { $("empErr").textContent = ""; });

function openEmp(id) {
  const emp = id ? state.employees.find((e) => e.id === id) : null;
  if (id && !emp) return;
  if (!canManage()) return;
  if (!can("empWrite")) return toast("직원 정보를 수정할 권한이 없습니다. (관리 → 권한 설정에서 최고관리자가 정합니다)", true);
  state.editing = emp;
  const self   = !!emp && emp.id === state.role.employeeId;
  const locked = !!emp && !isSuper() && (isAdmin() ? !ORG_LEVELS.includes(emp.level) : emp.level === "super"); // 본사 등급은 지점 관리자가, 최고관리자는 본사 인사가 수정할 수 없음

  $("dlgEmpTitle").textContent = emp ? (locked ? "직원 정보 (읽기 전용)" : "직원 정보 수정") : "직원 등록";
  $("dlgEmpId").textContent = emp ? emp.id : "사번은 자동으로 부여됩니다";

  const defOrgs = emp ? emp.orgIds
    : [state.orgs.some((o) => o.id === state.role.orgId) ? state.role.orgId : (state.orgs.find((o) => o.active !== false)?.id || "")].filter(Boolean);
  renderOrgChecks($("fOrgs"), { selected: defOrgs, disabled: isAdmin() || locked, onlyActive: !emp });

  const levels = Object.entries(LEVELS).filter(([k]) => (k !== "edu" || emp?.level === "edu") && (isSuper() || (isHR() ? k !== "super" : ORG_LEVELS.includes(k))));
  $("fLevel").innerHTML = levels.map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  // 본인 문서는 직원 문서에 등급이 비어 있어도 실제 권한(roles)을 보여주고 그대로 저장한다 (안 그러면 저장하다 내 권한이 낮아질 수 있음)
  $("fLevel").value = self && levels.some(([k]) => k === state.role.level) ? state.role.level : emp && levels.some(([k]) => k === emp.level) ? emp.level : "staff";
  $("fLevel").disabled = self || locked;
  $("fLevelHelp").textContent = self ? "본인 권한은 변경할 수 없습니다" :
    (isHR() ? "최고관리자: 전체(급여 포함) / 대표이사: 전체 지점 / 원장·부원장: 소속 지점 관리 / 실장·팀장: 소속 지점 조회·휴가 승인 / 사원: 본인 정보만" : "원장·부원장: 소속 지점 관리 / 실장·팀장: 소속 지점 조회·휴가 승인 / 사원: 본인 정보만");

  $("fName").value     = emp?.name || "";
  $("fEmail").value    = emp?.email || "";
  $("fCorp").value     = emp?.corp || "";
  $("fCorp").disabled  = locked;
  $("fPosition").value = emp?.position || "";
  $("fPhone").value    = emp?.phone || "";
  $("fJoined").value   = emp ? (emp.joinedAt || "") : todayStr();
  $("fBirth").value    = emp?.birthDate || "";
  $("fProbation").value = emp?.probationEndDate || "";
  $("fContractEnd").value = emp?.contractEndDate || "";
  $("fStatus").value   = emp?.status && STATUS[emp.status] ? emp.status : "active";
  $("fStatus").disabled = self || locked;
  $("fMemo").value     = emp?.memo || "";
  ["fName", "fEmail", "fPosition", "fPhone", "fJoined", "fBirth", "fProbation", "fContractEnd", "fMemo"].forEach((i) => ($(i).disabled = locked));
  $("empErr").textContent = "";
  $("btnEmpSave").classList.toggle("hidden", locked);
  $("btnEmpDelete").classList.toggle("hidden", !(emp && can("trash") && isHR() && !self && !locked));
  $("dlgEmp").showModal();
  if (!locked) $("fName").focus();
}

function validateEmp(d, emp) {
  if (!d.name) return "이름을 입력하세요.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return "올바른 이메일을 입력하세요.";
  if (!d.orgIds.length || !d.orgIds.every((id) => state.orgs.some((o) => o.id === id))) return "소속 지점을 하나 이상 선택하세요.";
  if (!LEVELS[d.level]) return "권한을 선택하세요.";
  if (!STATUS[d.status]) return "상태를 선택하세요.";
  if (isAdmin() && (!d.orgIds.includes(state.role.orgId) || !ORG_LEVELS.includes(d.level)))
    return "지점 관리자는 소속 지점 직원만, 사원·팀장·실장·부원장·원장 등급으로 등록할 수 있습니다.";
  if (!isSuper() && d.level === "super") return "최고관리자 권한은 최고관리자만 부여할 수 있습니다.";
  const dup = [...state.employees, ...state.trash].find((e) => e.email === d.email && e.id !== emp?.id);
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
    level:    $("fLevel").value,
    corp:     $("fCorp").value,
    position: $("fPosition").value.trim(),
    phone:    $("fPhone").value.trim(),
    joinedAt: $("fJoined").value,
    birthDate: $("fBirth").value,
    probationEndDate: $("fProbation").value,
    contractEndDate: $("fContractEnd").value,
    status:   $("fStatus").value,
    memo:     $("fMemo").value.trim(),
  };
  // 소속 지점: 대표(첫 번째) 지점은 기존 값을 유지. 관리자는 지점을 바꿀 수 없음
  let ids = readOrgChecks($("fOrgs"));
  if (isAdmin()) ids = emp ? emp.orgIds : [state.role.orgId];
  const primary = emp && ids.includes(emp.orgId) ? emp.orgId : ids[0];
  data.orgIds = primary ? [primary, ...ids.filter((x) => x !== primary)] : [];
  data.orgId = primary || "";
  const err = validateEmp(data, emp);
  if (err) { $("empErr").textContent = err; return; }
  setEmpBusy(true);
  try {
    if (!emp) {
      const id = await nextEmployeeId();
      await setDoc(doc(db, "employees", id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      audit("emp_create", { targetEmployeeId: id, detail: data.name });
      toast(`${data.name} 님을 등록했습니다 (${id})`);
    } else {
      await updateDoc(doc(db, "employees", emp.id), { ...data, updatedAt: serverTimestamp() });
      if (emp.level !== data.level || emp.orgId !== data.orgId || emp.status !== data.status) {
        await syncRoles(emp.id, data);
      }
      audit("emp_update", { targetEmployeeId: emp.id, detail: data.name });
      const changes = diffEmployee(emp, { ...emp, ...data }, STATUS, LEVELS);
      if (changes.length) await addAssignments({ ...emp, orgId: data.orgId }, changes);
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

// 직원을 휴지통으로 옮긴다 (목록에서 숨기고 로그인 권한 제거). 복원·완전 삭제는 관리 → 휴지통
async function trashEmployees(list) {
  if (!can("trash") || !can("empWrite")) return { ok: 0, fail: list.length };
  let ok = 0, fail = 0;
  for (const emp of list) {
    try {
      if (emp.id === state.role.employeeId) throw new Error("본인은 삭제할 수 없습니다");
      await updateDoc(doc(db, "employees", emp.id), { deleted: true, deletedAt: serverTimestamp(), deletedBy: state.user?.uid || "", status: "resigned", updatedAt: serverTimestamp() });
      await syncRoles(emp.id, { status: "resigned" });   // 연결된 roles 삭제
      audit("emp_trash", { targetEmployeeId: emp.id, detail: emp.name });
      ok++;
    } catch (e) { console.warn("휴지통 이동 실패", emp.id, e.code || e); fail++; }
  }
  return { ok, fail };
}
const TRASH_NOTE = "목록에서 사라지고 로그인 권한이 제거됩니다.\n관리 → 휴지통에서 복원하거나 완전히 삭제할 수 있습니다.";
$("btnEmpDelete").onclick = async () => {
  const emp = state.editing;
  if (!emp || !isHR()) return;
  if (!confirm(`${emp.name} (${emp.id}) 직원을 휴지통으로 옮길까요?\n${TRASH_NOTE}`)) return;
  setEmpBusy(true);
  const r = await trashEmployees([emp]);
  setEmpBusy(false);
  if (r.fail) { $("empErr").textContent = "휴지통으로 옮기지 못했습니다. 권한을 확인하세요 (최고관리자 계정은 본사 인사가 삭제할 수 없습니다)."; return; }
  toast("휴지통으로 옮겼습니다"); $("dlgEmp").close();
  await loadEmployees();
  if ((location.hash || "").startsWith("#emp/")) location.hash = "#employees"; else route();
};
$("bulkTrash").onclick = async () => {
  const targets = state.employees.filter((e) => lv.sel.has(e.id));
  if (!targets.length || !can("trash")) return;
  if (!confirm(`선택한 ${targets.length}명을 휴지통으로 옮길까요?\n${TRASH_NOTE}`)) return;
  const r = await trashEmployees(targets);
  toast(`${r.ok}명을 휴지통으로 옮겼습니다${r.fail ? `, ${r.fail}명 실패` : ""}`, !!r.fail);
  lv.sel.clear(); await loadEmployees(); renderEmployees(true);
};
// 사번 자동 부여: meta/counters.employee 를 트랜잭션으로 증가
async function nextEmployeeId() {
  const known = [...state.employees, ...state.trash].reduce((m, e) => {
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
      if (!isHR()) break; // 지점 관리자는 다른 지점 문서를 읽을 수 없어 카운터만 신뢰
      const ex = await tx.get(doc(db, "employees", id));
      if (!ex.exists()) break;
    }
    tx.set(ref, { employee: n }, { merge: true });
    return id;
  });
}

// ---------- 직원 일괄 등록 ----------
const BULK_MAX = 500;
// 앞 8개는 직원 기본 정보, 뒤 9개는 개인정보(private/personalInfo). 제목 줄이 없으면 이 순서로 읽음
const BULK_COLS = [
  { key: "name",     label: "이름",   alias: ["이름", "성명", "name"] },
  { key: "email",    label: "이메일", alias: ["이메일", "구글계정", "구글이메일", "메일", "email"] },
  { key: "org",      label: "소속 지점", alias: ["소속지점", "조직", "소속", "소속조직", "지점", "org"] },
  { key: "position", label: "직책",   alias: ["직책", "직위", "position"] },
  { key: "phone",    label: "전번",   alias: ["전번", "연락처", "전화", "전화번호", "휴대폰", "핸드폰", "phone"] },
  { key: "joinedAt", label: "입사일", alias: ["입사일", "입사", "joined"] },
  { key: "level",    label: "권한",   alias: ["권한", "등급", "level"] },
  { key: "status",   label: "상태",   alias: ["상태", "재직상태", "status"] },
  { key: "birthDate", label: "생년월일", alias: ["생년월일", "생일", "birth", "birthday"] },
  { key: "probationEndDate", label: "수습 종료일", alias: ["수습종료일", "수습종료", "수습만료일"] },
  { key: "contractEndDate",  label: "계약 만료일", alias: ["계약만료일", "계약종료일", "계약만료"] },
  { key: "address",          label: "주소",           alias: ["주소", "address"], pi: true },
  { key: "bankAccount",      label: "계좌번호",       alias: ["계좌번호", "계좌", "bank"], pi: true },
  { key: "guardianName",     label: "보호자 성명",    alias: ["보호자성명", "보호자이름", "보호자"], pi: true },
  { key: "guardianRelation", label: "보호자와의 관계", alias: ["보호자와의관계", "보호자관계", "관계"], pi: true },
  { key: "guardianPhone",    label: "보호자 연락처",  alias: ["보호자연락처", "보호자전화", "보호자전번"], pi: true },
  { key: "eduStartDate",     label: "교육시작일",     alias: ["교육시작일", "교육시작"], pi: true, date: true },
  { key: "workStartDate",    label: "근로시작일",     alias: ["근로시작일", "근로시작"], pi: true, date: true },
  { key: "insuranceRegDate", label: "4대보험 등록일", alias: ["4대보험등록일", "4대보험", "보험등록일"], pi: true, date: true },
  { key: "resignDate",       label: "퇴사일",         alias: ["퇴사일", "퇴직일"], pi: true, date: true },
  // 급여 정보(private/compensation) — 최고관리자만 입력 가능
  { key: "baseSalary",    label: "기본급", alias: ["기본급"], comp: true, num: true },
  { key: "mealAllowance", label: "식대",   alias: ["식대"],   comp: true, num: true },
  { key: "additionalLabel1",  label: "추가급여1 항목", alias: ["추가급여1항목", "추가급여1항목명", "추가급여1명"], comp: true },
  { key: "additionalSalary1", label: "추가급여1 금액", alias: ["추가급여1금액", "추가급여1"], comp: true, num: true },
  { key: "additionalLabel2",  label: "추가급여2 항목", alias: ["추가급여2항목", "추가급여2항목명", "추가급여2명"], comp: true },
  { key: "additionalSalary2", label: "추가급여2 금액", alias: ["추가급여2금액", "추가급여2"], comp: true, num: true },
  { key: "additionalLabel3",  label: "추가급여3 항목", alias: ["추가급여3항목", "추가급여3항목명", "추가급여3명"], comp: true },
  { key: "additionalSalary3", label: "추가급여3 금액", alias: ["추가급여3금액", "추가급여3"], comp: true, num: true },
  { key: "incentiveThreshold", label: "인센티브 기준", alias: ["인센티브기준", "인센티브초과기준", "인센티브-초과기준"], comp: true },
  { key: "incentiveAmount",    label: "인센티브 금액", alias: ["인센티브금액", "인센티브-금액"], comp: true, num: true },
  { key: "otherSalary", label: "기타 급여", alias: ["기타급여"], comp: true },
  { key: "memo",        label: "급여 메모", alias: ["급여메모"], comp: true, long: true },
  // 주민등록번호 (private/residentFront·residentBack). 하나로 붙여 쓰거나(900101-1234567) 앞·뒤를 나눠 쓴다
  { key: "rrn",      label: "주민등록번호",    alias: ["주민등록번호", "주민번호", "주번", "rrn"], rrn: true },
  { key: "rrnFront", label: "주민번호 앞자리", alias: ["주민번호앞자리", "주민등록번호앞자리", "주민앞자리", "주번앞"], rrn: true },
  { key: "rrnBack",  label: "주민번호 뒷자리", alias: ["주민번호뒷자리", "주민등록번호뒷자리", "주민뒷자리", "주번뒤"], rrn: true },
  { key: "corp",     label: "소속 법인", alias: ["소속법인", "법인", "법인명", "회사", "corp"] },
];
const LEVEL_WORDS  = { 사원: "staff", 직원: "staff", staff: "staff", 팀장: "lead", lead: "lead", 실장: "manager", manager: "manager", 부원장: "admin", 관리자: "admin", admin: "admin", 원장: "principal", principal: "principal", 대표이사: "hr", 대표: "hr", 본사인사: "hr", 인사: "hr", hr: "hr", 교육팀: "edu", 교육: "edu", edu: "edu", 최고관리자: "super", super: "super" };
const STATUS_WORDS = { 재직: "active", 재직중: "active", active: "active", 휴직: "leave", leave: "leave", 퇴직: "resigned", 퇴사: "resigned", resigned: "resigned" };
const bulk = { rows: [], busy: false };
const nrm = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

// 탭(엑셀/시트 복사) 또는 쉼표(CSV) 구분 텍스트를 2차원 배열로. 따옴표 안의 구분자·줄바꿈 처리
function parseDelimited(text) {
  text = text.replace(/^﻿/, "");
  const delim = text.includes("\t") ? "\t" : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  row.push(cell); rows.push(row);
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ""));
}

function normDate(s) {
  if (!s) return "";
  const m = /^(\d{4})\D+(\d{1,2})\D+(\d{1,2})\D*$/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 붙여넣은 텍스트 → 검증된 행 목록. 반환: { rows, fatal }
function parseBulk(text) {
  if (!text.trim()) return { rows: [], fatal: "" };
  const table = parseDelimited(text);
  if (!table.length) return { rows: [], fatal: "" };

  const aliasMap = {};
  BULK_COLS.forEach((c) => c.alias.concat(c.label).forEach((a) => (aliasMap[nrm(a)] = c.key)));
  const head = table[0].map((c) => aliasMap[nrm(c)]);
  const hasHeader = head.includes("name") || head.includes("email");
  let colIdx; // key -> 열 번호
  if (hasHeader) {
    colIdx = {};
    head.forEach((k, i) => { if (k && !(k in colIdx)) colIdx[k] = i; });
    if (!("email" in colIdx) || (!("name" in colIdx) && !(isHR() && $("bulkUpdate").checked)))
      return { rows: [], fatal: "제목 줄에 ‘이름’과 ‘이메일’ 열이 모두 있어야 합니다. (기존 직원 수정을 켜면 이메일 열만 있어도 됩니다)" };
  } else {
    colIdx = Object.fromEntries(BULK_COLS.map((c, i) => [c.key, i]));
  }
  const body = hasHeader ? table.slice(1) : table;
  if (body.length > BULK_MAX) return { rows: [], fatal: `한 번에 ${BULK_MAX}명까지 등록할 수 있습니다 (현재 ${body.length}행).` };

  const defOrg = $("bulkOrg").value;
  const seen = new Map(); // 이메일 -> 먼저 나온 행 번호
  const existing = new Map(state.employees.map((e) => [e.email, e]));
  const findOrg = (t) => state.orgs.find((o) => nrm(o.id) === nrm(t) || nrm(o.name) === nrm(t));
  const upsert = isHR() && $("bulkUpdate").checked;
  const rows = body.map((cells, idx) => {
    const line = idx + (hasHeader ? 2 : 1);
    const get = (k) => (k in colIdx ? (cells[colIdx[k]] ?? "").trim() : "");
    const errors = [];
    const d = {
      name: get("name"), email: get("email").toLowerCase(),
      position: get("position"), phone: get("phone"),
    };
    if (!d.name) errors.push("이름 없음");
    else if (d.name.length > 40) errors.push("이름이 40자 초과");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) errors.push("이메일 형식 오류");
    else if (existing.has(d.email) && !upsert) errors.push(`이미 등록된 이메일 (${existing.get(d.email).id}) — 기존 직원 수정을 켜면 갱신됩니다`);
    else if (seen.has(d.email)) errors.push(`${seen.get(d.email)}행과 이메일 중복`);
    if (d.email && !seen.has(d.email)) seen.set(d.email, line);

    // 소속 지점: 이름 또는 ID, 여러 곳이면 / ; · | , 로 구분 (첫 번째가 대표 지점)
    const orgRaw = get("org");
    const names = orgRaw ? orgRaw.split(/[\/;|·,]/).map((x) => x.trim()).filter(Boolean) : [];
    const ids = [];
    if (!names.length) { const o = state.orgs.find((x) => x.id === defOrg); if (o) ids.push(o.id); else errors.push("소속 지점 미지정"); }
    for (const n of names) {
      const o = findOrg(n);
      if (!o) errors.push(`지점 ‘${n}’ 없음`);
      else if (o.active === false) errors.push(`‘${o.name}’은 운영 중단 조직`);
      else if (!ids.includes(o.id)) ids.push(o.id);
    }
    d.orgIds = ids; d.orgId = ids[0] || "";

    const lvRaw = get("level");
    d.level = lvRaw ? LEVEL_WORDS[nrm(lvRaw)] : "staff";
    if (!d.level) errors.push(`권한 ‘${lvRaw}’ 알 수 없음`);
    const stRaw = get("status");
    d.status = stRaw ? STATUS_WORDS[nrm(stRaw)] : "active";
    if (!d.status) errors.push(`상태 ‘${stRaw}’ 알 수 없음`);
    const corpKey = corpFromText(get("corp"));
    if (corpKey === null) errors.push("소속 법인은 피크코퍼레이션(주) 또는 (주)제이드에듀");
    d.corp = corpKey || "";

    const jd = normDate(get("joinedAt"));
    if (jd === null) errors.push("입사일 형식 오류 (예: 2024-03-02)");
    d.joinedAt = jd || "";
    const bd = normDate(get("birthDate"));
    if (bd === null) errors.push("생년월일 형식 오류 (예: 1990-05-21)");
    d.birthDate = bd || "";
    for (const k of ["probationEndDate", "contractEndDate"]) {
      const nd = normDate(get(k)); const lbl = BULK_COLS.find((c) => c.key === k).label;
      if (nd === null) errors.push(`${lbl} 형식 오류`);
      d[k] = nd || "";
    }
    if (d.position.length > 30) errors.push("직책이 30자 초과");
    if (d.phone.length > 20) errors.push("전번이 20자 초과");

    // 개인정보 열
    const pi = {};
    for (const c of BULK_COLS.filter((x) => x.pi)) {
      let v = get(c.key);
      if (c.date) { const nd = normDate(v); if (nd === null) { errors.push(`${c.label} 형식 오류`); v = ""; } else v = nd; }
      else if (v.length > 200) errors.push(`${c.label}이 200자 초과`);
      if (v) pi[c.key] = v;
    }
    // 근로시작일은 입사일과 같다: 입사일만 있고 근로시작일 칸이 비어 있으면 입사일로 채운다
    if (!pi.workStartDate && d.joinedAt) pi.workStartDate = d.joinedAt;

    if (d.level === "super" && !isSuper()) errors.push("최고관리자 권한은 최고관리자만 부여");
    if (isAdmin() && d.level && !ORG_LEVELS.includes(d.level)) errors.push("지점 관리자는 사원·팀장·실장·부원장·원장 등급만 부여");
    if (isAdmin() && d.orgIds.length && (d.orgIds.length !== 1 || d.orgIds[0] !== state.role.orgId))
      errors.push("관리자는 소속 조직 직원만 등록 가능");
    // 급여 열 (숫자 칸은 1,000,000 / 100만원처럼 쉼표·‘원’이 있어도 숫자만 뽑음)
    const comp = {};
    for (const c of BULK_COLS.filter((x) => x.comp)) {
      let v = get(c.key);
      if (c.num && v) {
        const n = v.replace(/[,\s원]/g, "");
        if (!/^\d+$/.test(n)) { errors.push(`${c.label} 형식 오류 (숫자만)`); v = ""; } else v = n;
      } else if (v.length > (c.long ? 2000 : 200)) errors.push(`${c.label}이 너무 깁니다`);
      if (v) comp[c.key] = v;
    }
    if (Object.keys(comp).length && !can("comp")) errors.push("급여 정보를 등록할 권한이 없습니다");
    // 주민등록번호: 엑셀이 앞의 0을 지운 경우(숫자 5·12자리)는 0을 채워 읽는다. 화면에는 숫자를 보여 주지 않는다
    const rrn = { front: "", back: "" };
    {
      const dg = (v) => String(v ?? "").replace(/\D/g, "");
      let both = dg(get("rrn")), f = dg(get("rrnFront")), b = dg(get("rrnBack"));
      if (both) { if (both.length === 12) both = "0" + both; if (both.length === 13) { f = f || both.slice(0, 6); b = b || both.slice(6); } else if (both.length >= 5 && both.length <= 6) f = f || both.padStart(6, "0"); else errors.push("주민등록번호는 13자리(또는 앞 6자리)여야 합니다"); }
      if (f.length === 5) f = "0" + f;
      if (f && !/^\d{6}$/.test(f)) errors.push("주민번호 앞자리는 숫자 6자리");
      else if (f && !(Number(f.slice(2, 4)) >= 1 && Number(f.slice(2, 4)) <= 12 && Number(f.slice(4, 6)) >= 1 && Number(f.slice(4, 6)) <= 31)) errors.push("주민번호 앞자리의 월·일이 올바르지 않습니다");
      if (b && !/^[1-8]\d{6}$/.test(b)) errors.push("주민번호 뒷자리는 1~8로 시작하는 숫자 7자리");
      if (b && !(can("rrnBack") && state.settings?.rrnBackEnabled !== false)) { errors.push(state.settings?.rrnBackEnabled === false ? "주민번호 뒷자리 수집이 꺼져 있습니다 (관리 → 설정)" : "주민번호 뒷자리를 저장할 권한이 없습니다 (뒷자리 칸을 비우세요)"); b = ""; }
      if (!errors.some((x) => x.startsWith("주민"))) { rrn.front = f; rrn.back = b; }
    }
    // 생년월일 칸이 비어 있으면 주민번호로 채운다 (뒷자리가 있으면 정확, 없으면 나이로 추정)
    const rrnBirth = rrn.front ? birthFromRrn(rrn.front, rrn.back[0] || "") : "";
    if (!d.birthDate && rrnBirth) d.birthDate = rrnBirth;
    // 기존 직원 수정: 비워 둔 칸은 건드리지 않고, 채운 칸만 덮어쓴다
    const ex = upsert && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? existing.get(d.email) : null;
    if (ex) {
      const patch = {};
      for (const k of ["name", "position", "phone", "joinedAt", "birthDate", "probationEndDate", "contractEndDate", "corp"]) if (get(k)) patch[k] = d[k];
      if (!get("birthDate") && !ex.birthDate && rrnBirth) patch.birthDate = rrnBirth;
      if (lvRaw) patch.level = d.level;
      if (stRaw) patch.status = d.status;
      if (names.length) { patch.orgIds = d.orgIds; patch.orgId = d.orgId; }
      if (ex.level === "super" && !isSuper()) errors.push("최고관리자 계정은 수정할 수 없습니다");
      return { line, data: patch, pi, comp, rrn, errors: errors.filter((x) => !/소속 지점 미지정|이름 없음/.test(x)), update: ex, full: { ...ex, ...patch } };
    }
    return { line, data: d, pi, comp, rrn, errors };
  });
  return { rows, fatal: "" };
}

function renderBulk() {
  const { rows, fatal } = parseBulk($("bulkText").value);
  bulk.rows = rows;
  $("bulkErr").textContent = fatal;
  const okRows = rows.filter((r) => !r.errors.length);
  const bad = rows.length - okRows.length;
  $("bulkSummary").innerHTML = rows.length
    ? `총 ${rows.length}행 · <span class="ok">등록 가능 ${okRows.filter((r) => !r.update).length}명</span>` + (okRows.some((r) => r.update) ? ` · <span class="ok">기존 직원 수정 ${okRows.filter((r) => r.update).length}명</span>` : "") + (bad ? ` · <span class="bad">오류 ${bad}행 (건너뜀)</span>` : "")
    : "";
  $("bulkPreviewWrap").classList.toggle("hidden", !rows.length);
  $("bulkPreview").innerHTML = rows.length
    ? `<thead><tr><th>행</th><th>이름</th><th>이메일</th><th>소속 지점</th><th>직책</th><th>권한</th><th>상태</th><th>입사일</th><th>개인정보</th><th>급여</th><th>주민번호</th><th>결과</th></tr></thead><tbody>` +
      rows.map((r) => {
        const d = r.update ? r.full : r.data, ok = !r.errors.length;
        return `<tr class="${ok ? "" : "bad"}"><td class="sub">${r.line}</td><td class="strong">${esc(d.name)}${d.corp ? `<div class="sub">${esc(corpName(d.corp))}</div>` : ""}</td><td>${esc(d.email)}</td>
          <td>${esc(d.orgIds.length ? orgNames(d.orgIds) : "—")}</td><td>${esc(d.position || "—")}</td>
          <td>${d.level ? levelBadge(d.level) : "—"}</td><td>${d.status ? statusBadge(d.status) : "—"}</td>
          <td class="sub">${esc(d.joinedAt || "—")}</td><td class="sub">${Object.keys(r.pi).length ? Object.keys(r.pi).length + "개 항목" : "—"}</td>
          <td class="sub">${Object.keys(r.comp).length ? Object.keys(r.comp).length + "개 항목" : "—"}</td>
          <td class="sub">${r.rrn.front || r.rrn.back ? `${r.rrn.front ? "앞 ✔" : ""} ${r.rrn.back ? "뒤 ✔" : ""}` : "—"}</td>
          <td class="res ${ok ? "ok" : "bad"}">${ok ? (r.update ? `수정 (${esc(r.update.id)})` : "정상") : esc(r.errors.join(" · "))}</td></tr>`;
      }).join("") + `</tbody>`
    : "";
  const b = $("btnBulkSave");
  b.textContent = okRows.length ? `정상 ${okRows.length}명 ${okRows.every((r) => r.update) ? "수정" : "등록"}` : "등록";
  b.disabled = bulk.busy || okRows.length === 0;
}

function openBulk() {
  if (!canManage() || !can("empWrite")) return;
  const sel = $("bulkOrg");
  fillOrgSelect(sel, { onlyActive: true });
  sel.value = state.orgs.some((o) => o.id === state.role.orgId) ? state.role.orgId : (sel.options[0]?.value || "");
  sel.disabled = isAdmin();
  $("bulkText").value = ""; $("bulkFile").value = "";
  $("bulkUpdate").checked = false; $("bulkUpdateWrap").classList.toggle("hidden", !isHR());
  bulk.rows = []; bulk.busy = false;
  renderBulk();
  $("dlgBulk").showModal();
  $("bulkText").focus();
}

// 엑셀(.xlsx/.xls) 파일은 SheetJS 를 그때 불러와 첫 시트를 탭으로 구분한 글로 바꾼다
let sheetJs = null;
function loadSheetJs() {
  if (globalThis.XLSX) return Promise.resolve(globalThis.XLSX);
  return (sheetJs ||= new Promise((resolve, reject) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
    sc.onload = () => resolve(globalThis.XLSX); sc.onerror = () => { sheetJs = null; reject(new Error("엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV 로 저장해 올려주세요.")); };
    document.head.appendChild(sc);
  }));
}
async function readSheetFile(file) {
  const X = await loadSheetJs();
  const wb = X.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error("시트가 비어 있습니다.");
  // 날짜 칸은 Date 로 읽혀 오므로 직접 yyyy-mm-dd 로 바꾼다 (시간대 어긋남을 피하려고 12시간을 더한 뒤 UTC 날짜를 쓴다)
  const cell = (v) => {
    if (v instanceof Date) { const d = new Date(v.getTime() + 12 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; }
    return String(v ?? "").replace(/[\t\r\n]+/g, " ").trim();
  };
  return X.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: "" }).map((r) => r.map(cell).join("\t")).join("\n");
}
// UTF-8 우선, 실패하면 한국어 엑셀 CSV(EUC-KR/CP949)로 해석
async function readTextFile(file) {
  if (/\.(xlsx|xlsm|xls)$/i.test(file.name)) return readSheetFile(file);
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
  catch { return new TextDecoder("euc-kr").decode(buf); }
}

$("btnBulk").onclick = openBulk;
$("btnBulkCancel").onclick = () => { if (!bulk.busy) $("dlgBulk").close(); };
$("dlgBulk").addEventListener("cancel", (e) => { if (bulk.busy) e.preventDefault(); });
$("bulkText").addEventListener("input", renderBulk);
$("bulkOrg").addEventListener("change", renderBulk);
$("bulkUpdate").addEventListener("change", renderBulk);
$("bulkFile").addEventListener("change", async (ev) => {
  const f = ev.target.files[0];
  if (!f) return;
  try { $("bulkText").value = await readTextFile(f); renderBulk(); }
  catch (e) { $("bulkErr").textContent = "파일을 읽지 못했습니다: " + (e.message || e); }
});
$("btnBulkTemplate").onclick = () => {
  const o = state.orgs.find((x) => x.type !== "hq") || state.orgs[0];
  const sample = o?.name || "본사";
  const csvCell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const cols = BULK_COLS.filter((c) => (can("comp") || !c.comp) && (!c.rrn || c.key === (can("rrnBack") && state.settings?.rrnBackEnabled !== false ? "rrn" : "rrnFront")));
  const rows = [
    { name: "홍길동", email: "hong@gmail.com", org: sample, position: "교사", phone: "010-1234-5678", joinedAt: "2024-03-02", level: "사원", status: "재직", birthDate: "1995-05-21",
      address: "서울시 서초구 …", bankAccount: "신한 110-000-000000", guardianName: "홍부모", guardianRelation: "부", guardianPhone: "010-0000-0000",
      eduStartDate: "2024-02-01", workStartDate: "2024-03-02", insuranceRegDate: "2024-03-02",
      baseSalary: "2500000", mealAllowance: "100000", additionalLabel1: "자기 계발비", additionalSalary1: "50000", additionalLabel2: "차량 지원금", additionalSalary2: "100000", rrn: "900101-1234567", rrnFront: "900101", corp: "피크코퍼레이션(주)" },
    { name: "김원장", email: "kim@gmail.com", org: sample, position: "원장", phone: "010-9876-5432", joinedAt: "2020-01-01", level: "원장", status: "재직", workStartDate: "2020-01-01" },
  ];
  const csv = "\uFEFF" + [cols.map((c) => c.label), ...rows.map((r) => cols.map((c) => r[c.key] ?? ""))]
    .map((r) => r.map(csvCell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "직원_일괄등록_양식.csv";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// 사번을 count개 한꺼번에 확보 (카운터를 트랜잭션으로 증가, 이미 쓰는 사번은 건너뜀)
async function reserveEmployeeIds(count) {
  const used = new Set([...state.employees, ...state.trash].map((e) => e.id));
  const known = [...state.employees, ...state.trash].reduce((m, e) => {
    const n = /^emp_(\d+)$/.exec(e.id);
    return n ? Math.max(m, parseInt(n[1], 10)) : m;
  }, 1);
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "meta", "counters");
    const snap = await tx.get(ref);
    let n = Math.max(snap.exists() ? Number(snap.data().employee || 0) : 0, known);
    const ids = [];
    while (ids.length < count) {
      n += 1;
      const id = "emp_" + String(n).padStart(4, "0");
      if (!used.has(id)) ids.push(id);
    }
    tx.set(ref, { employee: n }, { merge: true });
    return ids;
  });
}

$("btnBulkSave").onclick = async () => {
  const allOk = bulk.rows.filter((r) => !r.errors.length);
  const updRows = allOk.filter((r) => r.update), okRows = allOk.filter((r) => !r.update);
  if (!allOk.length || bulk.busy) return;
  if (updRows.length && !confirm(`기존 직원 ${updRows.length}명의 정보를 파일 내용으로 덮어씁니다 (비워 둔 칸은 그대로 둡니다). 계속할까요?`)) return;
  bulk.busy = true;
  const btn = $("btnBulkSave");
  btn.disabled = true; $("btnBulkCancel").disabled = true;
  $("bulkErr").textContent = "";
  let saved = 0;
  try {
    btn.textContent = "사번 확보 중…";
    const ids = okRows.length ? await reserveEmployeeIds(okRows.length) : [];
    // 직원 1명당 문서 최대 6개(직원 + 개인정보 + 급여 + 주민번호 앞·뒤 + 표시) → 배치당 최대 420건.
    // 지점 관리자는 문서마다 규칙이 직원 문서를 조회하므로(한 번에 20건 한도) 작게 나눈다
    const CHUNK = isHR() ? 70 : 8;
    for (let i = 0; i < okRows.length; i += CHUNK) {
      btn.textContent = `등록 중… ${saved}/${okRows.length}`;
      const batch = writeBatch(db);
      okRows.slice(i, i + CHUNK).forEach((r, j) => {
        const id = ids[i + j];
        batch.set(doc(db, "employees", id), {
          ...r.data, memo: "", createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        });
        if (Object.keys(r.comp).length)
          batch.set(doc(db, "employees", id, "private", "compensation"),
            { ...r.comp, updatedAt: serverTimestamp(), updatedBy: state.user?.email || "" });
        if (Object.keys(r.pi).length)
          batch.set(doc(db, "employees", id, "private", "personalInfo"), { ...r.pi, updatedAt: serverTimestamp() });
        if (r.rrn.front || r.rrn.back) {
          const meta = { updatedAt: serverTimestamp(), updatedBy: state.user?.email || "" };
          if (r.rrn.front) batch.set(doc(db, "employees", id, "private", "residentFront"), { value: r.rrn.front, ...meta });
          if (r.rrn.back) batch.set(doc(db, "employees", id, "private", "residentBack"), { value: r.rrn.back, ...meta });
          batch.set(doc(db, "employees", id, "private", "flags"), { ...(r.rrn.front ? { residentFront: true } : {}), ...(r.rrn.back ? { residentBack: true } : {}) }, { merge: true });
        }
      });
      await batch.commit();
      saved += Math.min(CHUNK, okRows.length - i);
    }
    let updated = 0;
    for (const r of updRows) {
      btn.textContent = `수정 중… ${updated}/${updRows.length}`;
      const ex = r.update, id = ex.id;
      if (Object.keys(r.data).length) await updateDoc(doc(db, "employees", id), { ...r.data, updatedAt: serverTimestamp() });
      if (Object.keys(r.pi).length) await setDoc(doc(db, "employees", id, "private", "personalInfo"), { ...r.pi, updatedAt: serverTimestamp() }, { merge: true });
      if (r.rrn.front || r.rrn.back) {
        const meta = { updatedAt: serverTimestamp(), updatedBy: state.user?.email || "" };
        if (r.rrn.front) await setDoc(doc(db, "employees", id, "private", "residentFront"), { value: r.rrn.front, ...meta });
        if (r.rrn.back) await setDoc(doc(db, "employees", id, "private", "residentBack"), { value: r.rrn.back, ...meta });
        await setDoc(doc(db, "employees", id, "private", "flags"), { ...(r.rrn.front ? { residentFront: true } : {}), ...(r.rrn.back ? { residentBack: true } : {}) }, { merge: true });
      }
      if (Object.keys(r.comp).length) await setDoc(doc(db, "employees", id, "private", "compensation"), { ...r.comp, updatedAt: serverTimestamp(), updatedBy: state.user?.email || "" }, { merge: true });
      const after = { ...ex, ...r.data };
      if (ex.level !== after.level || ex.orgId !== after.orgId || ex.status !== after.status) await syncRoles(id, after);
      const changes = diffEmployee(ex, after, STATUS, LEVELS);
      if (changes.length) await addAssignments({ ...ex, orgId: after.orgId }, changes);
      updated++;
    }
    const nRrn = [...okRows, ...updRows].filter((r) => r.rrn.front || r.rrn.back).length;
    audit("bulk_import", { detail: `등록 ${saved}명${updated ? ` · 수정 ${updated}명` : ""}${nRrn ? ` · 주민번호 ${nRrn}명` : ""}` });
    if (nRrn) audit("rrn_save", { detail: `일괄 등록 ${nRrn}명` });
    $("bulkText").value = ""; $("bulkFile").value = "";   // 주민번호 등이 입력칸에 남지 않게
    toast(`${saved ? `${saved}명을 등록` : ""}${saved && updated ? ", " : ""}${updated ? `${updated}명을 수정` : ""}했습니다`);
    $("dlgBulk").close();
  } catch (e) {
    console.error(e);
    $("bulkErr").textContent =
      (saved ? `${saved}명까지 등록된 뒤 실패했습니다. 직원 목록에서 확인하고 남은 사람만 다시 등록하세요. ` : "등록에 실패했습니다. ") + errMsg(e);
  } finally {
    bulk.busy = false;
    $("btnBulkCancel").disabled = false;
    try { await loadEmployees(); route(); } catch (e) { console.error(e); }
    if ($("dlgBulk").open) { $("bulkText").value = ""; $("bulkFile").value = ""; renderBulk(); }
  }
};

// ---------- 조직 ----------
function renderOrgs() {
  $("btnAddOrg").classList.toggle("hidden", !isHR());
  renderOrgChart($("orgChart"));
  const rows = state.orgs.map((o) => {
    const mine = isHR() || o.id === state.role.orgId;
    const active = state.employees.filter((e) => e.orgIds.includes(o.id) && e.status === "active").length;
    return `<tr class="${isHR() ? "click" : ""}" data-id="${esc(o.id)}">
      <td class="mono">${esc(o.id)}</td><td class="strong">${esc(o.name)}</td>
      <td>${orgTypeBadge(o.type)}</td>
      <td class="num">${canManage() && mine ? active : "—"}</td>
      <td>${o.active === false ? badge("off", "운영 중단") : badge("s-active", "운영 중")}</td></tr>`;
  });
  $("tblOrgs").innerHTML =
    `<thead><tr><th>조직 ID</th><th>이름</th><th>구분</th><th class="num">재직 인원</th><th>상태</th></tr></thead>` +
    `<tbody>${rows.join("") || `<tr><td colspan="5" class="empty">조직이 없습니다</td></tr>`}</tbody>`;
  if (isHR()) $("tblOrgs").querySelectorAll("tr.click").forEach((tr) => (tr.onclick = () => openOrg(tr.dataset.id)));
}

$("btnAddOrg").onclick    = () => openOrg(null);
$("btnOrgCancel").onclick = () => $("dlgOrg").close();
$("formOrg").addEventListener("input", () => { $("orgErr").textContent = ""; });

function openOrg(id) {
  if (!isHR()) return;
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

// ---------- 내 서류 ----------
function renderDocs() {
  const me = state.me;
  if (me) { renderMyDocs(me.id); return; }
  $("docsRoot").innerHTML = `<div class="card"><p class="msg" style="margin:0">연결된 직원 정보가 없습니다. 먼저 ‘내 정보’에서 직원 정보를 등록하거나 관리자에게 연결을 요청하세요.</p></div>`;
}

// ---------- 내 정보 ----------
function renderMe() {
  const me = state.me, r = state.role, body = $("meBody");
  if (me) { showView("Detail"); renderDetail(me.id); return; }
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
          name, email: (state.user.email || "").toLowerCase(), orgId: r.orgId, orgIds: [r.orgId], level: r.level,
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

// ---------- 상세 화면 연결 ----------
initDetail({
  openEdit: (emp) => openEmp(emp.id),
  trash: async (emp) => {
    if (!confirm(`${emp.name} (${emp.id}) 직원을 휴지통으로 옮길까요?\n${TRASH_NOTE}`)) return;
    const r = await trashEmployees([emp]);
    if (r.fail) return toast("휴지통으로 옮기지 못했습니다. 권한을 확인하세요.", true);
    toast("휴지통으로 옮겼습니다"); await loadEmployees(); location.hash = "#employees";
  },
  reload: loadEmployees,
});
bindCertModal();
initLeave({ rerender: () => route() });
initCalendar({});
initNotices({ onRead: () => updateBadges() });
initPayslips({ onSeen: () => updateBadges() });
initAdmin({ reload: loadEmployees, rerender: () => route() });
