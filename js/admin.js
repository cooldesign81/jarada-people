// 관리 화면: 내보내기·백업, 감사 로그, 설정, 휴지통
import { db, auth, storage } from "./firebase.js";
import { ref, listAll } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query, orderBy, limit, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, can, isSuper, isHR, isAdmin, canManage, esc, toast, errMsg, orgNames, statusBadge, syncRoles, audit, tsMillis, toEmp, branchTags } from "./core.js";
import { AUDIT_ACTIONS, PERMS, PERM_LEVELS, PUBLIC_DOCS, SECRET_DOCS, DEFAULT_REQUIRED_DOCS } from "./schema.js";
import { today, diffDays } from "./dates.js";
import { birthFromRrn } from "./rrn.js";
import { renderDistribute } from "./payslips.js";
import { exportEmployees, backupAll, downloadText } from "./export.js";
import { fixedItems, won, num } from "./payroll-calc.js";
import { deleteEmployeeData } from "./detail.js";

let ctx = { reload: async () => {}, rerender: () => {} };
export function initAdmin(c) { ctx = { ...ctx, ...c }; }
const TABS = [
  { id: "export", label: "내보내기·백업", ok: () => canManage() },
  { id: "status", label: "현황 점검",     ok: () => isHR() },
  { id: "slips",  label: "급여 배포",    ok: () => can("comp") },
  { id: "labor",  label: "인건비",         ok: () => can("comp") },
  { id: "audit",  label: "감사 로그",     ok: () => can("audit") },
  { id: "perms",  label: "권한 설정",      ok: () => isSuper() },
  { id: "settings", label: "설정",        ok: () => isSuper() },
  { id: "trash",  label: "휴지통",        ok: () => can("trash") },
];
const adm = { tab: "" };

export async function renderAdmin() {
  const tabs = TABS.filter((t) => t.ok());
  try { const want = sessionStorage.getItem("jarada.adminTab"); if (want) { sessionStorage.removeItem("jarada.adminTab"); if (tabs.some((t) => t.id === want)) adm.tab = want; } } catch {}
  if (!tabs.some((t) => t.id === adm.tab)) adm.tab = tabs[0]?.id || "";
  $("adminTabs").innerHTML = tabs.map((t) => `<button class="subtab ${t.id === adm.tab ? "active" : ""}" data-t="${t.id}">${t.label}${t.id === "trash" && state.trash.length ? ` <span class="tab-badge" style="background:#767676">${state.trash.length}</span>` : ""}</button>`).join("");
  $("adminTabs").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { adm.tab = b.dataset.t; renderAdmin(); }));
  const body = $("adminBody");
  ({ slips: renderDistribute, perms: renderPerms, labor: renderLabor, status: renderStatus, export: renderExport, audit: renderAudit, settings: renderSettings, trash: renderTrash })[adm.tab]?.(body);
}

// ---------- 생년월일 채우기: 주민번호가 등록돼 있는데 생년월일이 비어 있는 직원 ----------
function renderBirthFill(el) {
  const targets = state.employees.filter((e) => e.status !== "resigned" && !e.birthDate);
  el.innerHTML = `<div class="card"><h2>생년월일 채우기</h2>
    <p>생년월일이 비어 있는 직원이 <b>${targets.length}명</b> 있습니다. 등록된 <b>주민등록번호</b>로 생년월일을 계산해 채웁니다 (달력의 생일 표시에 쓰입니다). 뒷자리를 볼 수 있으면 정확히, 앞자리만 있으면 나이(14~85세)로 추정하며 추정은 결과에 표시합니다.</p>
    ${can("empWrite") ? `<button class="btn btn-secondary" id="btnBfPlan" ${targets.length ? "" : "disabled"}>계산하기</button> <span class="sub" id="bfProg"></span>` : `<p class="sub">직원 정보를 수정할 권한이 없어 계산만 볼 수 없습니다.</p>`}<div id="bfOut"></div></div>`;
  $("btnBfPlan")?.addEventListener("click", async () => {
    $("btnBfPlan").disabled = true; const rows = []; let i = 0;
    const seeBack = can("rrnBack");
    for (let k = 0; k < targets.length; k += 8) await Promise.all(targets.slice(k, k + 8).map(async (e) => {
      let front = "", back = "";
      try { const d = await getDoc(doc(db, "employees", e.id, "private", "residentFront")); if (d.exists()) front = d.data().value || ""; } catch {}
      if (front && seeBack) { try { const d = await getDoc(doc(db, "employees", e.id, "private", "residentBack")); if (d.exists()) back = String(d.data().value || "")[0] || ""; } catch {} }
      rows.push({ e, front, exact: !!back, birth: front ? birthFromRrn(front, back) : "" });
      $("bfProg").textContent = `${++i} / ${targets.length}`;
    }));
    rows.sort((a, b) => a.e.name.localeCompare(b.e.name, "ko"));
    const ok = rows.filter((r) => r.birth), noFront = rows.filter((r) => !r.front).length, unknown = rows.filter((r) => r.front && !r.birth).length;
    $("bfOut").innerHTML = `<p style="margin:10px 0">채울 수 있는 직원 <b>${ok.length}명</b> · 주민번호 앞자리 없음 ${noFront}명 · 계산 불가 ${unknown}명</p>${ok.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th><input type="checkbox" id="bfAll" checked></th><th>이름</th><th>생년월일</th><th>근거</th></tr></thead><tbody>${ok.map((r, n) => `<tr><td><input type="checkbox" data-bf="${n}" checked></td><td class="strong">${esc(r.e.name)}</td><td>${esc(r.birth)}</td><td class="sub">${r.exact ? "뒷자리로 확정" : "나이로 추정 — 확인 필요"}</td></tr>`).join("")}</tbody></table></div><div class="row-actions" style="margin-top:10px"><button class="btn btn-primary" id="btnBfApply">선택한 직원에 채우기</button></div>` : ""}`;
    $("btnBfPlan").disabled = false;
    $("bfAll")?.addEventListener("change", () => el.querySelectorAll("[data-bf]").forEach((b) => (b.checked = $("bfAll").checked)));
    $("btnBfApply")?.addEventListener("click", async () => {
      const pick = [...el.querySelectorAll("[data-bf]:checked")].map((b) => ok[Number(b.dataset.bf)]);
      if (!pick.length || !confirm(`${pick.length}명의 생년월일을 채웁니다. 계속할까요?`)) return;
      let done = 0, fail = 0;
      for (const r of pick) { try { await updateDoc(doc(db, "employees", r.e.id), { birthDate: r.birth, updatedAt: serverTimestamp() }); r.e.birthDate = r.birth; done++; } catch (e) { console.warn(e.code || e); fail++; } }
      audit("birth_fill", { detail: `${done}명${fail ? ` (실패 ${fail}명)` : ""}` }); toast(`${done}명의 생년월일을 채웠습니다${fail ? `, ${fail}명 실패` : ""}`, !!fail); renderBirthFill(el);
    });
  });
}

// ---------- 근로시작일 채우기: 근로시작일은 입사일과 같으므로 비어 있는 직원을 입사일로 채운다 ----------
function renderWorkFill(el) {
  const targets = state.employees.filter((e) => e.joinedAt);
  el.innerHTML = `<div class="card"><h2>근로시작일 채우기</h2>
    <p>근로시작일은 입사일과 같습니다. 개인정보의 <b>근로시작일</b>이 비어 있는 직원을 <b>입사일</b>로 채웁니다. 이미 값이 있는 직원은 그대로 둡니다. 직원 수(${targets.length}명)만큼 읽기가 발생합니다.</p>
    ${can("empWrite") ? `<button class="btn btn-secondary" id="btnWfPlan" ${targets.length ? "" : "disabled"}>확인하기</button> <span class="sub" id="wfProg"></span><div id="wfOut"></div>` : `<p class="sub">직원 정보를 수정할 권한이 없습니다.</p>`}</div>`;
  $("btnWfPlan")?.addEventListener("click", async () => {
    $("btnWfPlan").disabled = true; const need = []; let i = 0;
    for (let k = 0; k < targets.length; k += 8) await Promise.all(targets.slice(k, k + 8).map(async (e) => {
      let has = "", ok = true;
      try { const d = await getDoc(doc(db, "employees", e.id, "private", "personalInfo")); if (d.exists()) has = d.data().workStartDate || ""; } catch { ok = false; }
      if (ok && !has) need.push(e);
      $("wfProg").textContent = `${++i} / ${targets.length}`;
    }));
    need.sort((a, b) => a.name.localeCompare(b.name, "ko"));
    $("wfOut").innerHTML = need.length ? `<p style="margin:10px 0">근로시작일이 비어 있는 직원 <b>${need.length}명</b></p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>이름</th><th>입사일 → 근로시작일</th></tr></thead><tbody>${need.map((e) => `<tr><td class="strong">${esc(e.name)}</td><td class="sub">${esc(e.joinedAt)}</td></tr>`).join("")}</tbody></table></div>
      <button class="btn btn-primary" id="btnWfApply" style="margin-top:10px">${need.length}명 채우기</button>` : `<p style="margin:10px 0">비어 있는 직원이 없습니다.</p>`;
    $("btnWfPlan").disabled = false;
    $("btnWfApply")?.addEventListener("click", async () => {
      if (!confirm(`${need.length}명의 근로시작일을 입사일로 채웁니다. 계속할까요?`)) return;
      let done = 0, fail = 0;
      for (const e of need) { try { await setDoc(doc(db, "employees", e.id, "private", "personalInfo"), { workStartDate: e.joinedAt, updatedAt: serverTimestamp() }, { merge: true }); done++; } catch (x) { console.warn(x.code || x); fail++; } }
      audit("workstart_fill", { detail: `${done}명${fail ? ` (실패 ${fail}명)` : ""}` }); toast(`${done}명의 근로시작일을 채웠습니다${fail ? `, ${fail}명 실패` : ""}`, !!fail); renderWorkFill(el);
    });
  });
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
    <p class="sub">필수 서류: ${req.map((k) => esc(docs.find((d) => d.key === k)?.label || k)).join(", ") || "없음"}${can("secDocs") ? "" : " · 비공개서류는 열람 권한이 없어 제외됩니다."}</p>
    <button class="btn btn-primary" id="btnScan">${st.rows ? "다시 점검" : "점검 시작"}</button> <span class="sub" id="scanProg"></span></div>
    <div id="scanOut"></div><div id="birthFill"></div><div id="workFill"></div>`;
  renderBirthFill($("birthFill")); renderWorkFill($("workFill"));
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
        const [pub, sec, certs] = await Promise.all([scanDocs(e, "pub"), can("secDocs") ? scanDocs(e, "sec") : Promise.resolve(null), certsOf(e)]);
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
        ${can("comp") ? `<label class="chk"><input type="checkbox" id="xpComp"> 급여 포함</label>` : ""}
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

// ---------- 권한 설정 (최고관리자 전용): 등급별로 기능을 켜고 끈다 ----------
function renderPerms(body) {
  const cur = (p) => (Array.isArray(state.perms?.[p.key]) ? state.perms[p.key] : p.def);
  body.innerHTML = `<div class="card"><h2>등급별 권한 설정</h2>
    <p>체크한 등급이 해당 기능을 쓸 수 있습니다. <b>최고관리자는 항상 모든 권한</b>을 가지며 바꿀 수 없습니다. 대표이사는 <b>전체 지점</b>, 원장·부원장·실장·팀장은 <b>소속 지점</b>에 대해서만 적용됩니다. 회색 ―는 그 등급에는 줄 수 없는 항목입니다.</p>
    <div class="tbl-wrap"><table class="tbl perm-tbl"><thead><tr><th>기능</th><th class="c">최고관리자</th>${PERM_LEVELS.map(([, n]) => `<th class="c">${n}</th>`).join("")}</tr></thead><tbody>
    ${PERMS.map((p) => `<tr><td><b>${esc(p.label)}</b><div class="sub">${esc(p.desc)}</div></td><td class="c">✔</td>${PERM_LEVELS.map(([k]) => p.levels.includes(k)
      ? `<td class="c"><input type="checkbox" data-perm="${p.key}" value="${k}" ${cur(p).includes(k) ? "checked" : ""} aria-label="${esc(p.label)} — ${k}"></td>` : `<td class="c sub">―</td>`).join("")}</tr>`).join("")}
    </tbody></table></div>
    <div class="notice" style="margin-top:12px">급여·주민번호 뒷자리·비공개서류를 다른 등급에 열어 주면 그 사람이 개인정보를 볼 수 있게 됩니다. 꼭 필요한 경우에만 켜세요. 변경 내용은 감사 로그에 남고, 저장하면 보안 규칙에도 바로 적용됩니다.</div>
    <div class="row-actions" style="margin-top:12px"><button class="btn btn-primary" id="btnPermSave">저장</button> <button class="btn btn-secondary" id="btnPermReset">기본값으로 되돌리기</button></div></div>
    <div class="card"><h2>설정할 수 없는 고정 규칙</h2><ul class="plain">
      <li>직원 <b>완전 삭제</b>, 권한 문서(roles) 관리, 설정·권한 설정·전체 백업은 최고관리자만 합니다.</li>
      <li>직원 본인은 자기 정보·휴가·교육 기록을 쓸 수 있고, 다른 사원의 정보는 볼 수 없습니다.</li>
      <li>자기 휴가는 본인이 승인할 수 없습니다 (최고관리자 제외).</li>
      <li>사원은 어떤 관리 기능도 받을 수 없고, 최고관리자 등급은 최고관리자만 줄 수 있습니다.</li></ul></div>`;
  const read = () => Object.fromEntries(PERMS.map((p) => [p.key, [...body.querySelectorAll(`input[data-perm="${p.key}"]:checked`)].map((c) => c.value)]));
  $("btnPermSave").onclick = async () => {
    const data = read();
    const risky = ["comp", "rrnBack", "secDocs"].filter((k) => data[k].length && !(state.perms?.[k] || []).length);
    if (risky.length && !confirm(`${risky.map((k) => PERMS.find((p) => p.key === k).label).join(", ")} 권한을 대표이사에게 엽니다. 개인정보를 볼 수 있게 됩니다. 계속할까요?`)) return;
    try {
      await setDoc(doc(db, "settings", "permissions"), { ...data, updatedAt: serverTimestamp(), updatedBy: auth.currentUser?.email || "" });
      state.perms = data; audit("perms_change", { detail: PERMS.map((p) => `${p.key}:${data[p.key].join("/") || "-"}`).join(" ") });
      toast("저장했습니다"); ctx.rerender();
    } catch (e) { console.error(e); toast(errMsg(e), true); }
  };
  $("btnPermReset").onclick = async () => {
    if (!confirm("모든 항목을 기본값으로 되돌립니다. 계속할까요?")) return;
    try { await deleteDoc(doc(db, "settings", "permissions")); state.perms = {}; audit("perms_change", { detail: "기본값으로 되돌림" }); toast("기본값으로 되돌렸습니다"); renderPerms(body); }
    catch (e) { console.error(e); toast(errMsg(e), true); }
  };
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
