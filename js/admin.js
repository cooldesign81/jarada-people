// 관리 화면: 내보내기·백업, 감사 로그, 설정, 휴지통
import { db, auth, storage } from "./firebase.js";
import { ref, listAll } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, limit, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, isSuper, isHR, isAdmin, canManage, esc, toast, errMsg, orgNames, statusBadge, syncRoles, audit, tsMillis, toEmp, branchTags } from "./core.js";
import { AUDIT_ACTIONS, PUBLIC_DOCS, SECRET_DOCS, DEFAULT_REQUIRED_DOCS } from "./schema.js";
import { today, diffDays } from "./dates.js";
import { exportEmployees, backupAll, downloadText } from "./export.js";
import { fixedItems, won, num } from "./payroll-calc.js";
import { deleteEmployeeData } from "./detail.js";
import { matUser, matSignIn, loadManagers, saveManagers, normEmail, validEmail, MAX_MANAGERS } from "./materials.js";

let ctx = { reload: async () => {}, rerender: () => {} };
export function initAdmin(c) { ctx = { ...ctx, ...c }; }
const TABS = [
  { id: "export", label: "내보내기·백업", ok: () => canManage() },
  { id: "status", label: "현황 점검",     ok: () => isHR() },
  { id: "labor",  label: "인건비",         ok: () => isSuper() },
  { id: "audit",  label: "감사 로그",     ok: () => isHR() },
  { id: "settings", label: "설정",        ok: () => isSuper() },
  { id: "trash",  label: "휴지통",        ok: () => isHR() },
];
const adm = { tab: "" };

export async function renderAdmin() {
  const tabs = TABS.filter((t) => t.ok());
  if (!tabs.some((t) => t.id === adm.tab)) adm.tab = tabs[0]?.id || "";
  $("adminTabs").innerHTML = tabs.map((t) => `<button class="subtab ${t.id === adm.tab ? "active" : ""}" data-t="${t.id}">${t.label}${t.id === "trash" && state.trash.length ? ` <span class="tab-badge" style="background:#767676">${state.trash.length}</span>` : ""}</button>`).join("");
  $("adminTabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { adm.tab = b.dataset.t; renderAdmin(); }));
  const body = $("adminBody");
  ({ labor: renderLabor, status: renderStatus, export: renderExport, audit: renderAudit, settings: renderSettings, trash: renderTrash })[adm.tab]?.(body);
}

// ---------- 현황 점검: 서류 미비·자격증 만료·계약 만료 ----------
const st = { rows: null, busy: false };
const keyOf = (name) => name.split("__")[0];
async function scanDocs(emp, folder) {
  try { return new Set((await listAll(ref(storage, `hr/${emp.id}/${folder}`))).items.map((i) => keyOf(i.name))); }
  catch (e) { return null; } // 권한 없음 등
}
function renderStatus(body) {
  const req = (state.settings?.requiredDocs || DEFAULT_REQUIRED_DOCS);
  const docs = [...PUBLIC_DOCS, ...SECRET_DOCS];
  body.innerHTML = `<div class="card"><h2>서류·자격 점검</h2>
    <p>재직 중인 직원의 필수 서류 제출 여부와 자격증 만료일을 한 번에 확인합니다. 직원 수만큼 읽기가 발생하므로 필요할 때만 실행하세요. 필수 서류는 ‘설정’ 탭에서 바꿉니다.</p>
    <p class="sub">필수 서류: ${req.map((k) => esc(docs.find((d) => d.key === k)?.label || k)).join(", ") || "없음"}${isSuper() ? "" : " · 비공개서류는 최고관리자만 확인할 수 있어 제외됩니다."}</p>
    <button class="btn btn-primary" id="btnScan">${st.rows ? "다시 점검" : "점검 시작"}</button> <span class="sub" id="scanProg"></span></div>
    <div id="scanOut"></div>`;
  const out = $("scanOut");
  const draw = () => {
    if (!st.rows) return;
    const miss = st.rows.filter((r) => r.missing.length), exp = st.rows.flatMap((r) => r.certs.map((c) => ({ ...c, name: r.e.name }))).filter((c) => c.n <= 60).sort((a, b) => a.n - b.n);
    out.innerHTML = `<div class="card"><h2>서류 미비 (${miss.length}명)</h2>${miss.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>소속</th><th>미제출 서류</th></tr></thead><tbody>${miss.map((r) => `<tr><td><a href="#emp/${esc(r.e.id)}">${esc(r.e.name)}</a></td><td>${esc(orgNames(r.e.orgIds))}</td><td>${r.missing.map((m) => `<span class="badge off">${esc(m)}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table></div>` : `<p>모두 제출했습니다.</p>`}</div>
      <div class="card"><h2>자격증 만료 (60일 이내·지남)</h2>${exp.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>자격증</th><th>만료일</th><th></th></tr></thead><tbody>${exp.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.title)}</td><td>${esc(c.expiresDate)}</td><td>${c.n < 0 ? `<span class="badge s-leave">${-c.n}일 지남</span>` : `D-${c.n}`}</td></tr>`).join("")}</tbody></table></div>` : `<p>해당하는 자격증이 없습니다.</p>`}</div>`;
  };
  draw();
  $("btnScan").onclick = async () => {
    if (st.busy) return; st.busy = true; $("btnScan").disabled = true;
    const list = state.employees.filter((e) => e.status !== "resigned"), rows = []; let i = 0;
    const certsOf = async (e) => {
      try { return (await getDocs(collection(db, "employees", e.id, "certs"))).docs.map((d) => d.data()).filter((c) => c.expiresDate).map((c) => ({ title: c.name, expiresDate: c.expiresDate, n: diffDays(today(), c.expiresDate) })); }
      catch { return []; }
    };
    for (let k = 0; k < list.length; k += 5) {
      await Promise.all(list.slice(k, k + 5).map(async (e) => {
        const [pub, sec, certs] = await Promise.all([scanDocs(e, "pub"), isSuper() ? scanDocs(e, "sec") : Promise.resolve(null), certsOf(e)]);
        const missing = req.filter((key) => {
          const isPub = PUBLIC_DOCS.some((d) => d.key === key); const got = isPub ? pub : sec;
          if (!got) return false; return !got.has(key);
        }).map((key) => docs.find((d) => d.key === key)?.label || key);
        rows.push({ e, missing, certs }); $("scanProg").textContent = `${++i} / ${list.length}`;
      }));
    }
    rows.sort((a, b) => a.e.name.localeCompare(b.e.name, "ko")); st.rows = rows; st.busy = false; renderStatus(body);
  };
}

// ---------- 인건비 (대표 전용): 지점별 월 고정급 합계 ----------
const lb = { rows: null, busy: false };
function renderLabor(body) {
  body.innerHTML = `<div class="card"><h2>지점별 인건비</h2>
    <p>재직·휴직 중인 직원의 급여 정보(기본급·식대·추가급여)를 더해 지점별 월 고정 인건비를 보여줍니다. 직원 수만큼 읽기가 발생합니다. 인센티브·기타 급여·4대보험 사업주 부담분은 포함하지 않습니다. 직원은 대표 지점 기준으로 한 곳에만 집계됩니다.</p>
    <button class="btn btn-primary" id="btnLabor">${lb.rows ? "다시 계산" : "계산하기"}</button> <span class="sub" id="laborProg"></span></div><div id="laborOut"></div>`;
  const draw = () => {
    if (!lb.rows) return;
    const byOrg = new Map(); for (const r of lb.rows) { const o = byOrg.get(r.orgId) || { n: 0, total: 0, noComp: 0 }; o.n++; o.total += r.total; if (!r.total) o.noComp++; byOrg.set(r.orgId, o); }
    const all = [...byOrg.values()].reduce((a, o) => ({ n: a.n + o.n, total: a.total + o.total }), { n: 0, total: 0 });
    $("laborOut").innerHTML = `<div class="card flush"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>지점</th><th class="num">인원</th><th class="num">월 고정 인건비</th><th class="num">1인 평균</th><th class="num">연 환산</th></tr></thead><tbody>${[...byOrg].map(([id, o]) => `<tr><td class="strong">${esc(orgNames([id]))}</td><td class="num">${o.n}${o.noComp ? ` <span class="sub">(급여 미입력 ${o.noComp})</span>` : ""}</td><td class="num">${won(o.total)}</td><td class="num">${o.n - o.noComp ? won(o.total / (o.n - o.noComp)) : "—"}</td><td class="num">${won(o.total * 12)}</td></tr>`).join("")}</tbody><tfoot><tr><td>합계</td><td class="num">${all.n}</td><td class="num">${won(all.total)}</td><td></td><td class="num">${won(all.total * 12)}</td></tr></tfoot></table></div></div>
      <div class="card"><button class="btn btn-secondary" id="btnLaborCsv">직원별 CSV 내려받기</button></div>`;
    $("btnLaborCsv").onclick = () => {
      const esc2 = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["사번", "이름", "지점", "직책", "월 고정급"].map(esc2).join(",")].concat(lb.rows.map((r) => [r.e.id, r.e.name, orgNames([r.orgId]), r.e.position || "", r.total].map(esc2).join(",")));
      downloadText(`자라다_인건비_${today().replaceAll("-", "")}.csv`, "\ufeff" + lines.join("\r\n"), "text/csv");
      audit("export", { detail: "인건비 CSV" });
    };
  };
  draw();
  $("btnLabor").onclick = async () => {
    if (lb.busy) return; lb.busy = true; $("btnLabor").disabled = true;
    const list = state.employees.filter((e) => e.status !== "resigned"), rows = []; let i = 0;
    for (let k = 0; k < list.length; k += 8) {
      await Promise.all(list.slice(k, k + 8).map(async (e) => {
        let total = 0;
        try { const d = await getDoc(doc(db, "employees", e.id, "private", "compensation")); if (d.exists()) total = fixedItems(d.data()).total; } catch {}
        rows.push({ e, orgId: e.orgId || e.orgIds[0], total }); $("laborProg").textContent = `${++i} / ${list.length}`;
      }));
    }
    rows.sort((a, b) => a.e.id.localeCompare(b.e.id)); lb.rows = rows; lb.busy = false; audit("labor_view", { detail: `${rows.length}명` }); renderLabor(body);
  };
}

// ---------- 내보내기·백업 ----------
function renderExport(body) {
  body.innerHTML = `
    <div class="card"><h2>직원 목록 내보내기 (CSV)</h2>
      <p>엑셀에서 바로 열립니다. 이름·이메일·소속 지점·권한·상태·직책·전번·입사일·생년월일은 항상 포함됩니다. 주민등록번호는 내보내지 않습니다.</p>
      <div class="chk-group" style="margin-bottom:12px">
        ${isHR() ? `<label class="chk"><input type="checkbox" id="xpPersonal"> 개인정보 포함 (주소·계좌·보호자·날짜)</label>` : ""}
        ${isSuper() ? `<label class="chk"><input type="checkbox" id="xpComp"> 급여 포함</label>` : ""}
      </div>
      <div class="row-actions"><button class="btn btn-primary" id="btnXp">내보내기 (${state.employees.length}명)</button><span class="msg" id="xpMsg" style="margin:0"></span></div></div>
    ${isSuper() ? `<div class="card"><h2>전체 백업 (JSON)</h2>
      <p>조직, 직원(개인정보·급여·발령·자격 등 하위 기록 포함), 휴가, 일정, 공지, 설정을 한 파일로 내려받습니다. 주민등록번호와 업로드한 서류 파일은 포함되지 않습니다. 파일에 민감한 정보가 들어 있으니 안전한 곳에 보관하세요.</p>
      <div class="row-actions"><button class="btn btn-secondary" id="btnBackup">전체 백업 내려받기</button><span class="msg" id="bkMsg" style="margin:0"></span></div>
      <div class="notice" style="margin-top:14px">자동 백업은 Firebase 콘솔에서 켭니다. Firestore Database → <strong>재해 복구</strong> 탭에서 ‘특정 시점으로 복구(PITR)’를 사용 설정하면 최근 7일 안의 어느 시점으로든 되돌릴 수 있고, 같은 탭의 예약 백업으로 정기 백업을 남길 수 있습니다 (요금제 업그레이드가 필요할 수 있습니다).</div></div>` : ""}`;
  $("btnXp").onclick = async () => {
    $("btnXp").disabled = true;
    await exportEmployees(state.employees, { personal: $("xpPersonal")?.checked, comp: $("xpComp")?.checked }, (d, n) => { $("xpMsg").textContent = `${d}/${n}`; });
    $("xpMsg").textContent = ""; $("btnXp").disabled = false;
  };
  $("btnBackup")?.addEventListener("click", async () => {
    $("btnBackup").disabled = true;
    await backupAll((d, n) => { $("bkMsg").textContent = `${d}/${n}`; });
    $("bkMsg").textContent = ""; $("btnBackup").disabled = false;
  });
}

// ---------- 감사 로그 ----------
const au = { rows: [], loaded: false, action: "", q: "", from: "", to: "" };
async function renderAudit(body) {
  if (!au.loaded) {
    body.innerHTML = `<div class="card"><p class="msg" style="margin:0">불러오는 중…</p></div>`;
    try { au.rows = (await getDocs(query(collection(db, "auditLogs"), orderBy("at", "desc"), limit(500)))).docs.map((d) => ({ id: d.id, ...d.data() })); au.loaded = true; }
    catch (e) { console.error(e); body.innerHTML = `<div class="card"><p class="msg error" style="margin:0">${esc(errMsg(e))}</p></div>`; return; }
  }
  const nameOf = (id) => [...state.employees, ...state.trash].find((e) => e.id === id)?.name || id || "";
  const day = (r) => new Date(tsMillis(r.at) || 0);
  const ymdOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const list = au.rows.filter((r) => (!au.action || r.action === au.action) && (!au.from || ymdOf(day(r)) >= au.from) && (!au.to || ymdOf(day(r)) <= au.to)
    && (!au.q || [r.actorName, r.actorEmail, nameOf(r.targetEmployeeId), r.detail].some((v) => String(v || "").toLowerCase().includes(au.q.toLowerCase()))));
  body.innerHTML = `<div class="card flush"><div class="card-head"><h2>감사 로그 <span class="sub">최근 500건</span></h2>
    <div class="row-actions"><select id="auAction"><option value="">모든 동작</option>${Object.entries(AUDIT_ACTIONS).map(([k, v]) => `<option value="${k}" ${au.action === k ? "selected" : ""}>${v}</option>`).join("")}</select>
      <input class="input" type="date" id="auFrom" value="${au.from}"><input class="input" type="date" id="auTo" value="${au.to}">
      <input class="input" id="auQ" placeholder="사용자·직원·내용 검색" value="${esc(au.q)}" style="min-width:180px"><button class="btn btn-secondary" id="auReload">새로고침</button></div></div>
    <div class="tbl-wrap"><table class="tbl">${list.length ? `<thead><tr><th>시각</th><th>사용자</th><th>동작</th><th>대상 직원</th><th>내용</th></tr></thead><tbody>${list.map((r) => `<tr>
      <td class="sub">${esc(day(r).toLocaleString("ko-KR"))}</td><td class="strong">${esc(r.actorName || r.actorEmail || "—")}<div class="sub">${esc(r.actorEmail || "")}</div></td>
      <td>${esc(AUDIT_ACTIONS[r.action] || r.action)}</td><td>${esc(nameOf(r.targetEmployeeId) || "—")}</td><td class="sub" style="white-space:normal">${esc(r.detail || "")}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="empty">기록이 없습니다.</td></tr></tbody>`}</table></div></div>`;
  const bind = (id, key, ev = "change") => $(id).addEventListener(ev, (e) => { au[key] = e.target.value; renderAudit(body); });
  bind("auAction", "action"); bind("auFrom", "from"); bind("auTo", "to");
  $("auQ").addEventListener("change", (e) => { au.q = e.target.value.trim(); renderAudit(body); });
  $("auReload").onclick = () => { au.loaded = false; renderAudit(body); };
}

// ---------- 설정 ----------
function renderSettings(body) {
  const s = state.settings || {};
  body.innerHTML = `
    <div class="card"><h2>등록 링크</h2>
      <p>직원에게 보내는 ‘등록 링크’의 기본 유효 기간입니다. 새로 발급할 때부터 적용되며, 직원 상세에서 언제든 재발급·폐기할 수 있습니다.</p>
      <div class="field" style="max-width:220px"><label for="stLinkDays">유효 기간 (일)</label><input class="input" id="stLinkDays" type="number" min="1" max="365" value="${Number(s.linkDays) || 14}"></div></div>
    <div class="card"><h2>주민등록번호 뒷자리</h2>
      <p>주민등록번호는 암호화해서 보관하는 것이 원칙입니다. 이 앱은 암호화 없이 저장하므로, 뒷자리를 더 이상 받지 않으려면 아래를 끄세요. 끄면 직원 화면에서 뒷자리 입력칸이 사라지고, 보안 규칙도 새 저장을 막습니다.</p>
      <label class="chk"><input type="checkbox" id="stRrnBack" ${s.rrnBackEnabled === false ? "" : "checked"}> 주민등록번호 뒷자리를 저장한다</label>
      <div style="margin-top:12px"><button class="btn btn-danger" id="btnRrnPurge">저장된 뒷자리 모두 삭제</button> <span class="sub">되돌릴 수 없습니다. 먼저 백업이 필요하면 직원별로 확인하세요.</span></div></div>
    <div class="card"><h2>필수 서류</h2><p>‘현황 점검’에서 제출 여부를 확인할 서류입니다.</p>
      <div class="chk-group">${[...PUBLIC_DOCS, ...SECRET_DOCS].map((d) => `<label class="chk"><input type="checkbox" name="stReq" value="${d.key}" ${(s.requiredDocs || DEFAULT_REQUIRED_DOCS).includes(d.key) ? "checked" : ""}> ${esc(d.label)}</label>`).join("")}</div></div>
    <button class="btn btn-primary" id="btnStSave">설정 저장</button>`;
  body.insertAdjacentHTML("beforeend", `
    <div class="card" id="stMat"><h2>재료 관리자 (자라다 재료 관리 앱)</h2>
      <p>재료 관리 앱의 <b>계정관리</b>(쇼핑몰 주소·아이디·비밀번호 보관함)를 열고 고칠 수 있는 구글 계정을 지정합니다. 여기 없는 계정은 보안 규칙에서 막힙니다. 이 설정은 재료 앱 쪽 Firebase 프로젝트에 저장되므로, 아래에서 <b>최고관리자 구글 계정으로 한 번 더 연결</b>해야 합니다. 보관함의 비밀번호는 별도로 정하며 이 화면에서는 보이지 않습니다.</p>
      <div id="matBody" class="sub">불러오는 중…</div></div>
  `);
  renderMaterialManagers();
  $("btnStSave").onclick = async () => {
    const days = Number($("stLinkDays").value);
    if (!(days >= 1 && days <= 365)) return toast("유효 기간은 1~365일입니다.", true);
    const data = { linkDays: Math.round(days), rrnBackEnabled: $("stRrnBack").checked, requiredDocs: [...body.querySelectorAll("input[name=stReq]:checked")].map((x) => x.value), updatedAt: serverTimestamp() };
    try { await setDoc(doc(db, "settings", "app"), data, { merge: true }); Object.assign(state.settings, data); audit("settings_change", { detail: `링크 ${data.linkDays}일 · 뒷자리 ${data.rrnBackEnabled ? "수집" : "수집 안 함"}` }); toast("저장했습니다"); }
    catch (e) { console.error(e); toast(errMsg(e), true); }
  };
  $("btnRrnPurge").onclick = async () => {
    if (!confirm("모든 직원의 주민등록번호 뒷자리를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?")) return;
    if (!confirm("정말 삭제할까요? 앞자리는 그대로 남습니다.")) return;
    $("btnRrnPurge").disabled = true; let n = 0;
    for (const e of [...state.employees, ...state.trash]) {
      try {
        const ref = doc(db, "employees", e.id, "private", "residentBack");
        if ((await getDoc(ref)).exists()) { await deleteDoc(ref); await setDoc(doc(db, "employees", e.id, "private", "flags"), { residentBack: false }, { merge: true }); n++; }
      } catch (err) { console.warn(err.code || err); }
    }
    audit("rrn_back_purge", { detail: `${n}명` }); toast(`${n}명의 뒷자리를 삭제했습니다`); $("btnRrnPurge").disabled = false;
  };
}

// ---------- 휴지통 ----------
function renderTrash(body) {
  const list = [...state.trash].sort((a, b) => tsMillis(b.deletedAt) - tsMillis(a.deletedAt));
  body.innerHTML = `<div class="card flush"><div class="card-head"><h2>휴지통</h2><span class="sub">삭제한 직원은 여기에 보관됩니다. 복원하면 ‘퇴직’ 상태가 됩니다.</span></div>
    <div class="tbl-wrap"><table class="tbl">${list.length ? `<thead><tr><th>이름</th><th>사번</th><th>이메일</th><th>소속</th><th>삭제일</th><th></th></tr></thead><tbody>${list.map((e) => `<tr>
      <td class="strong">${esc(e.name)}</td><td class="mono">${esc(e.id)}</td><td class="sub">${esc(e.email)}</td><td>${branchTags(e.orgIds)}</td>
      <td class="sub">${esc(tsMillis(e.deletedAt) ? new Date(tsMillis(e.deletedAt)).toLocaleDateString("ko-KR") : "—")}</td>
      <td><button class="btn btn-secondary btn-sm" data-restore="${esc(e.id)}">복원</button> ${isSuper() ? `<button class="btn btn-danger btn-sm" data-purge="${esc(e.id)}">완전 삭제</button>` : ""}</td></tr>`).join("")}</tbody>`
      : `<tbody><tr><td class="empty">휴지통이 비어 있습니다.</td></tr></tbody>`}</table></div></div>`;
  body.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", async () => {
    const e = state.trash.find((x) => x.id === b.dataset.restore); if (!e) return;
    try { await updateDoc(doc(db, "employees", e.id), { deleted: deleteField(), deletedAt: deleteField(), deletedBy: deleteField(), status: "resigned", updatedAt: serverTimestamp() });
      audit("emp_restore", { targetEmployeeId: e.id }); toast("복원했습니다 (퇴직 상태)"); await ctx.reload(); renderAdmin(); }
    catch (err) { console.error(err); toast(errMsg(err), true); }
  }));
  body.querySelectorAll("[data-purge]").forEach((b) => b.addEventListener("click", async () => {
    const e = state.trash.find((x) => x.id === b.dataset.purge); if (!e) return;
    if (!confirm(`${e.name} (${e.id}) 직원의 모든 데이터(개인정보·급여·서류·휴가 기록)를 완전히 삭제합니다. 되돌릴 수 없습니다.`)) return;
    try { await syncRoles(e.id, { status: "resigned" }); await deleteEmployeeData(e.id); await deleteDoc(doc(db, "employees", e.id));
      audit("emp_purge", { detail: `${e.name} (${e.id})` }); toast("완전히 삭제했습니다"); await ctx.reload(); renderAdmin(); }
    catch (err) { console.error(err); toast(errMsg(err), true); }
  }));
}

// ---------- 재료 관리자 지정 (재료 앱 프로젝트) ----------
async function renderMaterialManagers() {
  const box = $("matBody"); if (!box) return;
  let user = null;
  try { user = await matUser(); } catch (e) { console.warn(e); }
  if (!user) {
    box.innerHTML = `<button class="btn" id="matLogin">재료 앱 프로젝트에 최고관리자 계정으로 연결</button> <span class="sub">구글 로그인 창이 열립니다.</span>`;
    $("matLogin").onclick = async () => {
      try { await matSignIn(); renderMaterialManagers(); } catch (e) { console.error(e); toast(e?.code === "auth/popup-closed-by-user" ? "로그인 창이 닫혔습니다." : "연결하지 못했습니다: " + (e?.code || e?.message || e), true); }
    };
    return;
  }
  let cur;
  try { cur = await loadManagers(); }
  catch (e) {
    console.error(e);
    const denied = String(e?.code || "").includes("permission-denied");
    box.innerHTML = `<p class="sub" style="color:#b3261e">${denied ? `재료 앱 규칙이 <b>${esc(user.email || "")}</b> 계정을 최고관리자로 인정하지 않습니다. 재료 앱 보안 규칙(FIRESTORE_RULES.md)의 최고관리자 이메일 목록과 게시 여부를 확인하세요.` : esc(errMsg(e))}</p><button class="btn" id="matRetry">다시 시도</button>`;
    $("matRetry").onclick = () => renderMaterialManagers();
    return;
  }
  let list = cur.emails.slice();
  const draw = () => {
    box.innerHTML = `<p class="sub">연결된 계정: ${esc(user.email || "")}</p>
      <div id="matList" style="margin:8px 0">${list.length ? list.map((m, i) => `<div style="display:flex;gap:8px;align-items:center;margin:4px 0"><span>${esc(m)}</span><button class="btn btn-sm" data-i="${i}">제거</button></div>`).join("") : `<span class="sub">지정된 재료 관리자가 없습니다. 최고관리자만 계정관리를 열 수 있습니다.</span>`}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="field" style="min-width:240px"><label for="matNew">추가할 구글 이메일</label><input class="input" id="matNew" type="email" placeholder="name@gmail.com"></div><button class="btn" id="matAdd">추가</button></div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="matSave">재료 관리자 저장</button></div>`;
    box.querySelectorAll("[data-i]").forEach((b) => b.onclick = () => { list.splice(Number(b.dataset.i), 1); draw(); });
    const add = () => {
      const v = normEmail($("matNew").value);
      if (!validEmail(v)) return toast("이메일 형식이 올바르지 않습니다.", true);
      if (list.includes(v)) return toast("이미 지정돼 있습니다.", true);
      if (list.length >= MAX_MANAGERS) return toast(`최대 ${MAX_MANAGERS}명까지 지정할 수 있습니다.`, true);
      list.push(v); draw();
    };
    $("matAdd").onclick = add;
    $("matNew").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); add(); } });
    $("matSave").onclick = async () => {
      try { list = await saveManagers(list, user.email); audit("material_managers_change", { detail: list.join(", ") || "(없음)" }); toast("저장했습니다"); draw(); }
      catch (e) { console.error(e); toast(errMsg(e), true); }
    };
  };
  draw();
}
