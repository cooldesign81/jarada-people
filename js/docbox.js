// 관리 → 서류함 (최고관리자·대표이사 전용)
// 직원들이 올린 서류를 표 하나로 보고, 고른 것만 ZIP 한 파일로 내려받는다.
// 파일 위치·권한은 storage.rules 그대로 (비공개서류는 ‘비공개서류’ 권한이 있을 때만 보인다)
import { storage } from "./firebase.js";
import { ref, listAll, getMetadata, getBlob, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import { $, state, can, isHR, esc, toast, orgNames, audit, statusBadge } from "./core.js";
import { PUBLIC_DOCS, SECRET_DOCS, DEFAULT_REQUIRED_DOCS } from "./schema.js";
import { today } from "./dates.js";

const ZIP_LIB = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
let zipLoading = null;
const loadZip = () => (zipLoading ||= new Promise((resolve, reject) => {
  if (globalThis.JSZip) return resolve();
  const s = document.createElement("script"); s.src = ZIP_LIB; s.onload = resolve;
  s.onerror = () => { zipLoading = null; reject(new Error("압축 도구를 불러오지 못했습니다. 네트워크를 확인하세요.")); };
  document.head.appendChild(s);
}));

const box = { errs: [], rows: null, busy: false, sel: new Set(), org: "all", status: "work", q: "", onlyMiss: false, group: "emp" };
const fileParts = (name) => { const m = /^([A-Za-z0-9]+)__(\d+)__(.*)$/.exec(name); return m ? { key: m[1], ts: Number(m[2]), orig: m[3] } : { key: "", ts: 0, orig: name }; };
const cols = () => [...PUBLIC_DOCS, ...(can("secDocs") ? SECRET_DOCS : []), ...(can("secDocs") ? [{ key: "etc", label: "기타", multi: true }] : [])];
const required = () => state.settings?.requiredDocs || DEFAULT_REQUIRED_DOCS;
const ymd = (ts) => { if (!ts) return ""; const d = new Date(ts); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "파일";

async function listFolder(empId, folder) {
  try {
    const res = await listAll(ref(storage, `hr/${empId}/${folder}`));
    return await Promise.all(res.items.map(async (it) => {
      const p = fileParts(it.name);
      let label = "";
      if (p.key === "etc") { try { label = (await getMetadata(it)).customMetadata?.label || ""; } catch {} }
      return { path: it.fullPath, ...p, label };
    }));
  } catch (e) { console.warn("목록 실패", empId, folder, e.code || e); box.errs.push(e.code || String(e.message || e)); return []; }
}

async function scan(body) {
  if (box.busy) return; box.busy = true; box.sel.clear(); box.errs = [];
  const list = state.employees, rows = []; let i = 0;
  const prog = $("dbProg"); $("dbScan").disabled = true;
  for (let k = 0; k < list.length; k += 6) {
    await Promise.all(list.slice(k, k + 6).map(async (e) => {
      const [pub, sec] = await Promise.all([listFolder(e.id, "pub"), can("secDocs") ? listFolder(e.id, "sec") : Promise.resolve([])]);
      const files = {};
      for (const f of [...pub, ...sec]) {
        if (f.key === "photo" || f.key === "eval") continue;      // 프로필 사진·인사 평가는 서류함에 넣지 않는다
        (files[f.key] ||= []).push(f);
      }
      for (const k2 in files) files[k2].sort((a, b) => b.ts - a.ts);
      rows.push({ e, files });
      if (prog) prog.textContent = `${++i} / ${list.length}명 확인 중…`;
    }));
  }
  rows.sort((a, b) => (a.e.name || "").localeCompare(b.e.name || "", "ko"));
  box.rows = rows; box.busy = false; renderDocBox(body);
}

// 칸 하나에 들어가는 파일: 고정 서류는 최신 1개, 기타는 전부
const cellFiles = (r, c) => { const f = r.files[c.key] || []; return c.multi ? f : f.slice(0, 1); };
function visibleRows() {
  const q = box.q.trim().toLowerCase(), req = required(), cs = cols();
  return (box.rows || []).filter(({ e, files }) => {
    if (box.status === "work" && e.status === "resigned") return false;
    if (box.status === "resigned" && e.status !== "resigned") return false;
    if (box.org !== "all" && !(e.orgIds || []).includes(box.org)) return false;
    if (q && !`${e.name || ""} ${e.id}`.toLowerCase().includes(q)) return false;
    if (box.onlyMiss && !cs.some((c) => req.includes(c.key) && !(files[c.key] || []).length)) return false;
    return true;
  });
}

export function renderDocBox(body) {
  if (!isHR()) { body.innerHTML = `<div class="card"><p>최고관리자·대표이사만 볼 수 있습니다.</p></div>`; return; }
  const cs = cols(), req = required();
  const orgs = state.orgs.filter((o) => o.type !== "hq" || state.employees.some((e) => (e.orgIds || []).includes(o.id)));
  const head = `<div class="card"><h2>서류함</h2>
    <p>직원들이 올린 서류를 한 표에서 보고, 원하는 것만 골라 <b>ZIP 파일 하나</b>로 받습니다. 칸의 체크박스로 고르고, 열 제목·이름 옆 체크박스로 한 줄씩 한 번에 고를 수 있어요. 파일 이름을 누르면 그 파일만 바로 받아요.</p>
    <p class="sub">직원 수만큼 파일 목록을 읽으므로 필요할 때 불러오세요. 프로필 사진·인사 평가 파일은 넣지 않습니다.${can("secDocs") ? "" : " 비공개서류(등본·통장 등)는 ‘비공개서류’ 권한이 없어 보이지 않습니다."} 빨간 <span class="badge db-miss">미제출</span>은 ‘설정’의 필수 서류입니다.</p>
    <button class="btn btn-primary" id="dbScan">${box.rows ? "다시 불러오기" : "서류 불러오기"}</button> <span class="sub" id="dbProg"></span>
    ${box.rows && box.errs.length ? `<div class="notice danger" style="margin-top:12px"><b>파일 목록을 ${box.errs.length}번 읽지 못했어요</b> (${esc([...new Set(box.errs)].join(", "))}). 표에 빠진 서류가 있을 수 있어요.
      ${box.errs.some((c) => /unauthorized|permission/i.test(c)) ? "<br>파일 저장소(Storage) 보안 규칙이 최신으로 게시됐는지 확인해 주세요." : ""}</div>` : ""}</div>`;
  if (!box.rows) { body.innerHTML = head; $("dbScan").onclick = () => scan(body); return; }

  const rows = visibleRows();
  const allFiles = rows.flatMap((r) => cs.flatMap((c) => cellFiles(r, c)));
  const missCnt = (c) => rows.filter((r) => !(r.files[c.key] || []).length).length;
  const ck = (paths) => paths.length && paths.every((p) => box.sel.has(p));
  const cell = (r, c) => {
    const fs = cellFiles(r, c);
    if (!fs.length) return req.includes(c.key) ? `<span class="badge db-miss">미제출</span>` : `<span class="sub">—</span>`;
    return fs.map((f) => `<label class="db-file" title="${esc(f.orig)} · ${ymd(f.ts)} 올림"><input type="checkbox" data-db-f="${esc(f.path)}" ${box.sel.has(f.path) ? "checked" : ""}>
      <a href="#" data-db-dl="${esc(f.path)}" data-name="${esc(f.orig)}">${esc(c.multi ? (f.label || f.orig) : f.orig)}</a><span class="sub"> ${ymd(f.ts)}</span></label>`).join("");
  };
  body.innerHTML = head + `<div class="card">
    <div class="db-bar">
      <select id="dbOrg" aria-label="지점"><option value="all">전체 지점</option>${orgs.map((o) => `<option value="${esc(o.id)}" ${box.org === o.id ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select>
      <select id="dbStatus" aria-label="재직 상태"><option value="work" ${box.status === "work" ? "selected" : ""}>재직·휴직</option><option value="all" ${box.status === "all" ? "selected" : ""}>퇴직 포함 전체</option><option value="resigned" ${box.status === "resigned" ? "selected" : ""}>퇴직자만</option></select>
      <input type="search" id="dbQ" placeholder="이름·사번 찾기" value="${esc(box.q)}" aria-label="이름·사번 찾기">
      <label class="chk"><input type="checkbox" id="dbMiss" ${box.onlyMiss ? "checked" : ""}> 미제출 있는 사람만</label>
    </div>
    <div class="db-bar">
      <label class="chk"><input type="checkbox" id="dbAll" ${ck(allFiles.map((f) => f.path)) ? "checked" : ""} ${allFiles.length ? "" : "disabled"}> 보이는 서류 전체 (${allFiles.length}개)</label>
      <b id="dbCnt">${box.sel.size}개 선택</b>
      <span class="seg-lbl">ZIP 안 폴더</span>
      <label class="chk"><input type="radio" name="dbGroup" value="emp" ${box.group === "emp" ? "checked" : ""}> 직원별</label>
      <label class="chk"><input type="radio" name="dbGroup" value="doc" ${box.group === "doc" ? "checked" : ""}> 서류별</label>
      <button class="btn btn-primary" id="dbZip" ${box.sel.size ? "" : "disabled"}>선택한 서류 ZIP으로 받기</button>
      <button class="btn btn-secondary btn-sm" id="dbClear" ${box.sel.size ? "" : "disabled"}>선택 해제</button>
    </div>
    <div class="tbl-wrap"><table class="tbl db-tbl"><thead><tr><th>이름</th><th>소속</th>
      ${cs.map((c) => { const ps = rows.flatMap((r) => cellFiles(r, c)).map((f) => f.path); return `<th><label class="chk" title="이 서류 전부 고르기"><input type="checkbox" data-db-col="${c.key}" ${ck(ps) ? "checked" : ""} ${ps.length ? "" : "disabled"}> ${esc(c.label)}</label><div class="sub">${ps.length}개${req.includes(c.key) && missCnt(c) ? ` · 미제출 ${missCnt(c)}` : ""}</div></th>`; }).join("")}
    </tr></thead><tbody>
    ${rows.map((r, n) => { const ps = cs.flatMap((c) => cellFiles(r, c)).map((f) => f.path); return `<tr><td class="strong"><label class="chk" title="이 직원 서류 전부 고르기"><input type="checkbox" data-db-row="${n}" ${ck(ps) ? "checked" : ""} ${ps.length ? "" : "disabled"}> <a href="#emp/${esc(r.e.id)}">${esc(r.e.name || r.e.id)}</a></label>${r.e.status === "resigned" ? ` ${statusBadge("resigned")}` : ""}</td><td class="sub">${esc(orgNames(r.e.orgIds))}</td>${cs.map((c) => `<td>${cell(r, c)}</td>`).join("")}</tr>`; }).join("") || `<tr><td colspan="${cs.length + 2}" class="sub">조건에 맞는 직원이 없습니다.</td></tr>`}
    </tbody></table></div><div id="dbOut"></div></div>`;

  $("dbScan").onclick = () => scan(body);
  const rerender = () => renderDocBox(body);
  $("dbOrg").onchange = (e) => { box.org = e.target.value; rerender(); };
  $("dbStatus").onchange = (e) => { box.status = e.target.value; rerender(); };
  $("dbMiss").onchange = (e) => { box.onlyMiss = e.target.checked; rerender(); };
  let t; $("dbQ").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { box.q = e.target.value; rerender(); const q = $("dbQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 250); };
  body.querySelectorAll("input[name=dbGroup]").forEach((x) => (x.onchange = () => { box.group = x.value; }));
  const toggle = (paths, on) => { paths.forEach((p) => (on ? box.sel.add(p) : box.sel.delete(p))); rerender(); };
  $("dbAll").onchange = (e) => toggle(allFiles.map((f) => f.path), e.target.checked);
  $("dbClear").onclick = () => { box.sel.clear(); rerender(); };
  body.querySelectorAll("[data-db-col]").forEach((x) => (x.onchange = () => { const c = cs.find((c2) => c2.key === x.dataset.dbCol); toggle(rows.flatMap((r) => cellFiles(r, c)).map((f) => f.path), x.checked); }));
  body.querySelectorAll("[data-db-row]").forEach((x) => (x.onchange = () => { const r = rows[Number(x.dataset.dbRow)]; toggle(cs.flatMap((c) => cellFiles(r, c)).map((f) => f.path), x.checked); }));
  body.querySelectorAll("[data-db-f]").forEach((x) => (x.onchange = () => toggle([x.dataset.dbF], x.checked)));
  body.querySelectorAll("[data-db-dl]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); downloadOne(a.dataset.dbDl, a.dataset.name); }));
  $("dbZip").onclick = () => makeZip(cs);
}

async function downloadOne(path, name) {
  try {
    const url = await getDownloadURL(ref(storage, path));
    const a = document.createElement("a"); a.href = url; a.download = name || "file"; a.target = "_blank"; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    audit("file_download", { targetEmployeeId: path.split("/")[1], detail: `서류함 · ${name || path}` });
  } catch (e) { console.error(e); toast("다운로드 실패: " + (e.code || e.message), true); }
}

async function makeZip(cs) {
  const picks = [];
  for (const r of box.rows || []) for (const c of cs) for (const f of r.files[c.key] || []) if (box.sel.has(f.path)) picks.push({ r, c, f });
  if (!picks.length) return;
  const btn = $("dbZip"), out = $("dbOut"); btn.disabled = true;
  try {
    await loadZip();
    const zip = new globalThis.JSZip(), used = new Set(), fails = [];
    let i = 0, cors = false;
    for (const { r, c, f } of picks) {
      btn.textContent = `압축 중… ${++i} / ${picks.length}`;
      try {
        const blob = await getBlob(ref(storage, f.path));
        const person = safe(`${r.e.name || ""}_${r.e.id}`), docName = safe(c.multi && f.label ? `기타_${f.label}` : c.label);
        let p = box.group === "doc" ? `${docName}/${person}_${safe(f.orig)}` : `${person}/${docName}_${safe(f.orig)}`;
        for (let k = 2; used.has(p); k++) p = p.replace(/(\.[^./]*)?$/, (m) => ` (${k})${m}`);
        used.add(p); zip.file(p, blob);
      } catch (e) {
        console.warn("받기 실패", f.path, e.code || e);
        if (!e.code || /unknown|retry-limit|network/i.test(e.code)) cors = true;
        fails.push({ r, c, f });
      }
    }
    const ok = picks.length - fails.length;
    if (ok) {
      const data = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(data); a.download = `자라다_서류_${today().replaceAll("-", "")}.zip`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      audit("file_download", { detail: `서류함 ZIP ${ok}개 (${[...new Set(picks.map((x) => x.r.e.name))].length}명)` });
    }
    out.innerHTML = fails.length ? `<div class="notice" style="margin-top:12px">
      <b>${fails.length}개 파일은 ZIP에 넣지 못했어요.</b>${ok ? ` (나머지 ${ok}개는 받았어요)` : ""}
      ${cors ? `<br>파일 저장소에 ‘브라우저에서 내려받기(CORS)’ 설정이 아직 없어서일 가능성이 커요. 한 번만 설정하면 됩니다 — 대표님께 안내드린 순서를 따라 주세요. 그 전까지는 아래 이름을 하나씩 눌러 받을 수 있어요.` : "<br>아래 이름을 눌러 하나씩 받아 보세요."}
      <ul>${fails.map(({ r, c, f }) => `<li>${esc(r.e.name)} · ${esc(c.label)} — <a href="#" data-db-dl="${esc(f.path)}" data-name="${esc(f.orig)}">${esc(f.orig)}</a></li>`).join("")}</ul></div>` : "";
    out.querySelectorAll("[data-db-dl]").forEach((a) => (a.onclick = (ev) => { ev.preventDefault(); downloadOne(a.dataset.dbDl, a.dataset.name); }));
    toast(fails.length ? `${ok}개 받음 · ${fails.length}개 실패` : `${ok}개 파일을 ZIP으로 받았습니다`, !!fails.length && !ok);
  } catch (e) { console.error(e); toast(e.message || "ZIP을 만들지 못했습니다", true); }
  btn.disabled = false; btn.textContent = "선택한 서류 ZIP으로 받기";
}
