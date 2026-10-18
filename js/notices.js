// 공지사항: 전체 또는 지점별 공지, 상단 고정, 읽음 확인
// notices/{id}            공지 본문
// noticeReads/{uid}       사용자별 읽은 공지 목록 { reads: { 공지ID: true }, employeeId, name, orgId }
import { db, auth } from "./firebase.js";
import { collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, deleteDoc, query, where, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, can, isHR, isAdmin, esc, toast, errMsg, orgName, orgNames, renderOrgChecks, readOrgChecks, tsMillis, audit } from "./core.js";

const N = { list: [], mine: {}, readers: null, loaded: false, open: "" };
const canWrite = () => can("noticeWrite");
const canEdit = (n) => can("noticeWrite") && (isHR() || isAdmin() && n.scope === "org" && (n.orgIds || []).length === 1 && n.orgIds[0] === state.role.orgId);
const ymdOf = (t) => { const d = new Date(tsMillis(t) || Date.now()); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };

export async function loadNotices() {
  try {
    const col = collection(db, "notices");
    const qs = isHR() ? [col] : [query(col, where("scope", "==", "all")), query(col, where("orgIds", "array-contains", state.role.orgId))];
    const seen = new Map();
    for (const q of qs) (await getDocs(q)).docs.forEach((d) => seen.set(d.id, { id: d.id, ...d.data() }));
    N.list = [...seen.values()].sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || (tsMillis(b.createdAt) - tsMillis(a.createdAt))).slice(0, 100);
    const r = await getDoc(doc(db, "noticeReads", auth.currentUser.uid));
    N.mine = r.exists() ? (r.data().reads || {}) : {};
    N.loaded = true;
  } catch (e) { console.warn("공지 불러오기 실패", e.code || e); N.list = []; N.mine = {}; N.loaded = true; }
}
export const unreadCount = () => N.list.filter((n) => !N.mine[n.id]).length;

async function markRead(n) {
  if (N.mine[n.id] || !state.role.employeeId) return;
  N.mine = { ...N.mine, [n.id]: true };
  try {
    await setDoc(doc(db, "noticeReads", auth.currentUser.uid), { reads: N.mine, employeeId: state.role.employeeId, name: state.me?.name || "", orgId: state.role.orgId || "", updatedAt: serverTimestamp() });
  } catch (e) { console.warn("읽음 표시 실패", e.code || e); }
  ctx.onRead?.();
}
let ctx = {};
export function initNotices(c) { ctx = c; }

function targets(n) {
  return state.employees.filter((e) => e.status !== "resigned" && (n.scope === "all" || e.orgIds.some((o) => (n.orgIds || []).includes(o))));
}
async function loadReaders() {
  try {
    const col = collection(db, "noticeReads");
    const q = isHR() ? col : query(col, where("orgId", "==", state.role.orgId));
    N.readers = (await getDocs(q)).docs.map((d) => d.data());
  } catch (e) { console.warn("읽음 현황 실패", e.code || e); N.readers = []; }
}

export async function renderNotices() {
  const root = $("noticeBody");
  $("btnNoticeNew").classList.toggle("hidden", !canWrite());
  if (!N.loaded) { root.innerHTML = `<div class="msg">불러오는 중…</div>`; await loadNotices(); }
  if (!N.list.length) { root.innerHTML = `<div class="card"><div class="msg">등록된 공지가 없습니다.</div></div>`; return; }
  root.innerHTML = N.list.map((n) => {
    const unread = !N.mine[n.id], open = N.open === n.id;
    const tgt = n.scope === "all" ? "전체" : orgNames(n.orgIds);
    return `<div class="card notice ${unread ? "unread" : ""}" data-id="${esc(n.id)}">
      <div class="notice-head" data-toggle="${esc(n.id)}" role="button" tabindex="0">
        <div>${n.pinned ? `<span class="badge s-leave">고정</span> ` : ""}${unread ? `<span class="badge s-active">새 글</span> ` : ""}<strong>${esc(n.title)}</strong></div>
        <div class="sub">${esc(n.createdByName || "")} · ${ymdOf(n.createdAt)} · 대상 ${esc(tgt)}</div></div>
      ${open ? `<div class="notice-body">${esc(n.body || "")}</div>
        <div class="row-actions">${canEdit(n) ? `<button class="btn btn-secondary btn-sm" data-edit="${esc(n.id)}">수정</button> <button class="btn btn-danger btn-sm" data-del="${esc(n.id)}">삭제</button> <button class="btn btn-secondary btn-sm" data-stat="${esc(n.id)}">읽음 현황</button>` : ""}</div>
        <div id="stat_${esc(n.id)}"></div>` : ""}</div>`;
  }).join("");
  root.querySelectorAll("[data-toggle]").forEach((h) => {
    const go = () => { const n = N.list.find((x) => x.id === h.dataset.toggle); N.open = N.open === n.id ? "" : n.id; renderNotices(); if (N.open) markRead(n).then(() => { const c = root.querySelector(`.notice[data-id="${n.id}"]`); c?.classList.remove("unread"); c?.querySelector(".badge.s-active")?.remove(); }); };
    h.onclick = go; h.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  root.querySelectorAll("[data-edit]").forEach((b) => (b.onclick = () => openNotice(N.list.find((x) => x.id === b.dataset.edit))));
  root.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => removeNotice(N.list.find((x) => x.id === b.dataset.del))));
  root.querySelectorAll("[data-stat]").forEach((b) => (b.onclick = () => showStat(N.list.find((x) => x.id === b.dataset.stat))));
}

async function showStat(n) {
  const el = $("stat_" + n.id); el.innerHTML = `<div class="msg">불러오는 중…</div>`;
  await loadReaders();
  const got = new Set(N.readers.filter((r) => r.reads?.[n.id]).map((r) => r.employeeId));
  const tg = targets(n), read = tg.filter((e) => got.has(e.id)), un = tg.filter((e) => !got.has(e.id));
  el.innerHTML = `<div class="stat"><b>읽음 ${read.length} / ${tg.length}명</b>
    <div class="sub">읽지 않음: ${un.length ? un.map((e) => esc(e.name)).join(", ") : "없음"}</div>
    <div class="sub">읽음: ${read.length ? read.map((e) => esc(e.name)).join(", ") : "없음"}</div></div>`;
}

function openNotice(n) {
  N.editing = n || null;
  $("ntTitle").value = n?.title || ""; $("ntBody").value = n?.body || ""; $("ntPinned").checked = !!n?.pinned; $("ntErr").textContent = "";
  $("ntDlgTitle").textContent = n ? "공지 수정" : "공지 작성";
  const sc = $("ntScope"); sc.innerHTML = isHR() ? `<option value="all">전체 지점</option><option value="org">지점 선택</option>` : `<option value="org">내 지점 (${esc(orgName(state.role.orgId))})</option>`;
  sc.value = n?.scope || (isHR() ? "all" : "org"); sc.disabled = !isHR();
  renderOrgChecks($("ntOrgs"), { selected: n?.orgIds?.length ? n.orgIds : (isHR() ? [] : [state.role.orgId]), disabled: !isHR(), onlyActive: true });
  $("ntOrgWrap").classList.toggle("hidden", sc.value === "all");
  $("dlgNotice").showModal();
}
$("ntScope").onchange = () => $("ntOrgWrap").classList.toggle("hidden", $("ntScope").value === "all");
$("btnNoticeNew").onclick = () => openNotice(null);
$("btnNtCancel").onclick = () => $("dlgNotice").close();
$("btnNtSave").onclick = async () => {
  const title = $("ntTitle").value.trim(), body = $("ntBody").value.trim(), scope = $("ntScope").value;
  const orgIds = scope === "all" ? [] : (isHR() ? readOrgChecks($("ntOrgs")) : [state.role.orgId]);
  if (!title) return ($("ntErr").textContent = "제목을 입력하세요.");
  if (!body) return ($("ntErr").textContent = "내용을 입력하세요.");
  if (scope === "org" && !orgIds.length) return ($("ntErr").textContent = "대상 지점을 선택하세요.");
  const data = { title, body, scope, orgIds, pinned: $("ntPinned").checked, updatedAt: serverTimestamp() };
  try {
    if (N.editing) await updateDoc(doc(db, "notices", N.editing.id), data);
    else await addDoc(collection(db, "notices"), { ...data, createdAt: serverTimestamp(), createdBy: auth.currentUser.uid, createdByName: state.me?.name || auth.currentUser.email || "" });
    audit(N.editing ? "notice_update" : "notice_create", { detail: title });
    $("dlgNotice").close(); await loadNotices(); renderNotices(); ctx.onRead?.(); toast("저장했습니다");
  } catch (e) { console.error(e); $("ntErr").textContent = errMsg(e); }
};
async function removeNotice(n) {
  if (!confirm(`‘${n.title}’ 공지를 삭제할까요?`)) return;
  try { await deleteDoc(doc(db, "notices", n.id)); audit("notice_delete", { detail: n.title }); await loadNotices(); renderNotices(); ctx.onRead?.(); toast("삭제했습니다"); }
  catch (e) { console.error(e); toast(errMsg(e), true); }
}
