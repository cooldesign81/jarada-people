// 공용 상태·유틸 (app.js / detail.js 가 함께 사용)
import { db, auth } from "./firebase.js";
import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc, query, where, serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

export const $ = (id) => document.getElementById(id);

export const LEVELS    = { super: "최고관리자", hr: "대표이사", principal: "원장", admin: "부원장", manager: "실장", lead: "팀장", staff: "사원", edu: "교육팀" };   // 교육팀(edu)은 예전 등급: 기존 데이터만 표시하고 새로 부여하지는 않음
export const ORG_LEVELS = ["staff", "lead", "manager", "admin", "principal"];   // 지점 관리자가 부여할 수 있는 등급
export const STATUS    = { active: "재직", leave: "휴직", resigned: "퇴직" };
export const ORG_TYPES = { hq: "본사", branch: "지점" };

export const state = {
  user: null, role: null,
  orgs: [], employees: [], me: null,
  leaves: [], events: [], settings: {}, trash: [],
  selfMode: false,            // 등록 링크(익명 로그인)로 들어온 경우
  editing: null, editingOrg: null,
  noRoleReason: "",
};
export const isSuper   = () => state.role?.level === "super";
export const isHR      = () => ["super", "hr"].includes(state.role?.level);          // 모든 지점 관리
export const isAdmin   = () => ["admin", "principal"].includes(state.role?.level);   // 소속 지점 관리
export const canManage = () => isHR() || isAdmin();
export const isMgr     = () => ["admin", "principal", "manager", "lead"].includes(state.role?.level);   // 휴가 승인 등 지점 관리자 계열(실장 포함)
export const canApprove = () => isHR() || isMgr();

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
let toastTimer;
export function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 4500 : 2200);
}
export function errMsg(e) {
  const code = String(e?.code || "");
  if (code.includes("permission-denied") || code.includes("unauthorized"))
    return "권한이 없습니다. 보안 규칙(firestore.rules / storage.rules)이 게시됐는지, 권한 문서가 맞는지 확인하세요.";
  if (code.includes("unavailable")) return "네트워크 연결을 확인해주세요.";
  if (code.includes("failed-precondition"))
    return "Firestore 인덱스가 필요합니다. 브라우저 콘솔(F12)의 링크에서 인덱스를 생성하세요.";
  if (code.includes("storage/")) return "파일 저장소 오류: " + code + " (Storage 설정과 규칙을 확인하세요)";
  return e?.message || String(e);
}

export function orgName(id) { return state.orgs.find((o) => o.id === id)?.name || id || "—"; }
export function orgNames(ids) { return (ids || []).map(orgName).join(", ") || "—"; }
export function badge(cls, text) { return `<span class="badge ${cls}">${esc(text)}</span>`; }
export function statusBadge(s) { return badge("s-" + (STATUS[s] ? s : "resigned"), STATUS[s] || s || "—"); }
export function levelBadge(l)  { return badge("l-" + (LEVELS[l] ? l : "staff"), LEVELS[l] || l || "—"); }
export function orgTypeBadge(t){ return badge("o-" + (ORG_TYPES[t] ? t : "branch"), ORG_TYPES[t] || t || "—"); }
export function branchTags(ids) {
  return (ids || []).map((id) => `<span class="branch-tag">${esc(orgName(id))}</span>`).join("");
}
export function fmtDate(s) { return s || "—"; }
export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function tsMillis(t) { return t?.toMillis ? t.toMillis() : (t?.seconds ? t.seconds * 1000 : 0); }

// 직원 문서 → 객체. orgIds(소속 지점 목록)가 없던 예전 문서는 orgId 로 보정
export function toEmp(d) {
  const e = { id: d.id, ...d.data() };
  e.orgIds = Array.isArray(e.orgIds) && e.orgIds.length ? e.orgIds : (e.orgId ? [e.orgId] : []);
  return e;
}

// 소속 지점 체크박스 그룹. selected: 선택된 id 목록, lockedIds: 체크 상태를 바꿀 수 없는 id
export function renderOrgChecks(el, { selected = [], disabled = false, onlyActive = false } = {}) {
  const orgs = state.orgs.filter((o) => !onlyActive || o.active !== false || selected.includes(o.id));
  const unknown = selected.filter((id) => !state.orgs.some((o) => o.id === id));
  el.innerHTML =
    orgs.map((o) => `<label class="chk"><input type="checkbox" value="${esc(o.id)}" ${selected.includes(o.id) ? "checked" : ""} ${disabled ? "disabled" : ""}> ${esc(o.name)}${o.active === false ? " (운영 중단)" : ""}</label>`).join("") +
    unknown.map((id) => `<label class="chk"><input type="checkbox" value="${esc(id)}" checked ${disabled ? "disabled" : ""}> ${esc(id)} (알 수 없음)</label>`).join("");
  if (!el.innerHTML) el.innerHTML = `<span class="msg">조직이 없습니다. 조직 메뉴에서 먼저 만들어주세요.</span>`;
}
export function readOrgChecks(el) {
  return [...el.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
}

// 직원 정보 변경 → 연결된 roles 동기화 (퇴직이면 권한 제거). orgId = 대표(첫 번째) 지점
export async function syncRoles(employeeId, data) {
  const col = collection(db, "roles");
  const q = isHR()
    ? query(col, where("employeeId", "==", employeeId))
    : query(col, where("employeeId", "==", employeeId), where("orgId", "==", state.role.orgId));
  const qs = await getDocs(q);
  await Promise.all(qs.docs.map((d) => {
    if (data.status === "resigned") return deleteDoc(d.ref);
    // 등록 링크로 만들어진 권한(selfToken)은 항상 ‘직원’ 등급 유지 — 승격되지 않게 건너뜀
    if (d.data().selfToken) return null;
    // 내 권한 문서는 내가 직원 정보를 고치다가 바뀌지 않게 건너뜀 (실수로 내 권한이 낮아지는 사고 방지)
    if (d.id === auth.currentUser?.uid) return null;
    return updateDoc(d.ref, { level: data.level, orgId: data.orgId });
  }));
}

// 열람·수정 기록 (auditLogs). 실패해도 화면 동작에는 영향 없음
export async function audit(action, extra = {}) {
  try {
    const u = auth.currentUser;
    if (!u) return;
    await addDoc(collection(db, "auditLogs"), {
      actorUid: u.uid, actorEmail: u.email || "", actorName: state.me?.name || (u.isAnonymous ? "등록 링크" : ""),
      actorLevel: state.role?.level || "", action, at: serverTimestamp(), ...extra,
    });
  } catch (e) { console.warn("감사 기록 실패", action, e.code || e); }
}

// 등록 링크로 만들어진 권한(selfToken)을 모두 삭제 (최고관리자·본사 인사만 가능)
export async function revokeLinkRoles(employeeId) {
  if (!isHR()) return;
  try {
    const qs = await getDocs(query(collection(db, "roles"), where("employeeId", "==", employeeId)));
    await Promise.all(qs.docs.filter((d) => d.data().selfToken).map((d) => deleteDoc(d.ref)));
  } catch (e) { console.warn("링크 권한 정리 실패", e.code || e); }
}
