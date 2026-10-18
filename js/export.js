// 내보내기(CSV)와 전체 백업(JSON)
import { db } from "./firebase.js";
import { doc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { state, isSuper, isHR, toast, errMsg, orgNames, audit, LEVELS, STATUS } from "./core.js";
import { PERSONAL_FIELDS, COMP_FIELDS } from "./schema.js";
import { today } from "./dates.js";

const csvCell = (v) => { v = String(v ?? ""); return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
export function downloadText(name, text, type = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}
async function readPrivate(empId, name) {
  try { const s = await getDoc(doc(db, "employees", empId, "private", name)); return s.exists() ? s.data() : {}; }
  catch (e) { return {}; }
}
async function pool(items, size, fn, onStep) {
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); onStep?.(++done, items.length); }
  }));
}

export const BASE_COLUMNS = [
  ["사번", (e) => e.id], ["이름", (e) => e.name], ["이메일", (e) => e.email], ["소속 지점", (e) => orgNames(e.orgIds)],
  ["권한", (e) => LEVELS[e.level] || e.level], ["상태", (e) => STATUS[e.status] || e.status], ["직책", (e) => e.position],
  ["전번", (e) => e.phone], ["입사일", (e) => e.joinedAt], ["생년월일", (e) => e.birthDate], ["수습 종료일", (e) => e.probationEndDate], ["계약 만료일", (e) => e.contractEndDate],
];

// 직원 목록 CSV. personal/comp 는 직원마다 하위 문서를 읽으므로 시간이 걸린다. 주민등록번호는 내보내지 않는다.
export async function exportEmployees(list, { personal = false, comp = false } = {}, onStep) {
  if (!list.length) return toast("내보낼 직원이 없습니다.", true);
  personal = personal && isHR(); comp = comp && isSuper();
  try {
    const cols = [...BASE_COLUMNS];
    const extra = {};
    if (personal) { PERSONAL_FIELDS.forEach((f) => cols.push([f.label, (e) => extra[e.id]?.pi?.[f.key]])); }
    if (comp) COMP_FIELDS.forEach(([k, label]) => cols.push([`급여 ${label}`, (e) => extra[e.id]?.comp?.[k]]));
    if (personal || comp) {
      await pool(list, 8, async (e) => {
        extra[e.id] = { pi: personal ? await readPrivate(e.id, "personalInfo") : {}, comp: comp ? await readPrivate(e.id, "compensation") : {} };
      }, onStep);
    }
    const csv = "﻿" + [cols.map((c) => c[0]), ...list.map((e) => cols.map((c) => c[1](e)))].map((r) => r.map(csvCell).join(",")).join("\r\n");
    downloadText(`자라다_직원_${today().replaceAll("-", "")}.csv`, csv);
    audit("export", { detail: `${list.length}명${personal ? " · 개인정보" : ""}${comp ? " · 급여" : ""}` });
    toast(`${list.length}명을 내보냈습니다`);
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}

// 전체 백업(JSON). 주민등록번호(앞·뒤)는 포함하지 않는다. 대표 전용.
export async function backupAll(onStep) {
  if (!isSuper()) return toast("대표만 전체 백업을 받을 수 있습니다.", true);
  try {
    const all = async (name) => (await getDocs(collection(db, name))).docs.map((d) => ({ id: d.id, ...d.data() }));
    const emps = [...state.employees, ...state.trash];
    const out = { app: "jarada-people", exportedAt: new Date().toISOString(), note: "주민등록번호는 포함되지 않습니다. 개인정보가 들어 있으니 안전하게 보관하세요.", employees: [] };
    for (const name of ["orgs", "leaveRequests", "calendarEvents", "notices"]) { try { out[name] = await all(name); } catch { out[name] = []; } }
    try { const s = await getDoc(doc(db, "settings", "app")); out.settings = s.exists() ? s.data() : {}; } catch { out.settings = {}; }
    const subs = ["personalInfo", "flags", "compensation"];
    await pool(emps, 6, async (e) => {
      const rec = { ...e, private: {} };
      for (const n of subs) { const d = await readPrivate(e.id, n); if (Object.keys(d).length) rec.private[n] = d; }
      for (const sc of ["assignments", "certs", "enrollments", "reviews", "compHistory", "certIssues"]) {
        try { const q = await getDocs(collection(db, "employees", e.id, sc)); if (q.size) rec[sc] = q.docs.map((d) => { const x = { id: d.id, ...d.data() }; if (x.snapshot?.rrn) x.snapshot = { ...x.snapshot, rrn: "" }; return x; }); } catch {}
      }
      out.employees.push(rec);
    }, onStep);
    out.employees.sort((a, b) => a.id.localeCompare(b.id));
    downloadText(`자라다_백업_${today().replaceAll("-", "")}.json`, JSON.stringify(out, null, 2), "application/json");
    audit("backup", { detail: `직원 ${out.employees.length}명` });
    toast("백업 파일을 내려받았습니다");
  } catch (e) { console.error(e); toast(errMsg(e), true); }
}
