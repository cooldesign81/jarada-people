// 급여 명세서, 근로계약서 초안, 퇴직금 예상, 지점별 인건비 (모두 최고관리자 전용)
// ※ 4대보험·세금은 자동 계산하지 않는다 (요율이 해마다 바뀜). 명세서에는 직접 입력한 금액만 담는다.
import { esc, state, toast } from "./core.js";
import { today, fmtKo } from "./dates.js";
import { num, won, fixedItems, severanceEstimate } from "./payroll-calc.js";
export { num, won, fixedItems, severanceEstimate };
import { COMPANY_INFO, STAMP_IMAGES, corpName } from "./company.js";

const CSS = `body{font-family:"Malgun Gothic","Pretendard",sans-serif;padding:50px;color:#111;font-size:14px;line-height:1.7}
h1{text-align:center;font-size:24px;margin:0 0 24px}h2{font-size:15px;margin:22px 0 8px}
table{width:100%;border-collapse:collapse;margin-bottom:14px}td,th{border:1px solid #333;padding:8px 12px;text-align:left}th{background:#f2f2f2}
td.r,th.r{text-align:right}.total td{font-weight:700;background:#fafafa}.sub{color:#555;font-size:12px}
.sign{display:flex;justify-content:space-between;gap:30px;margin-top:40px}.sign>div{flex:1;line-height:2}
.stamp{position:relative;display:inline-block;width:64px;height:44px;text-align:center}.stamp img{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:60px;mix-blend-mode:multiply}
.draft{margin-top:30px;padding:10px 14px;border:1px dashed #999;color:#555;font-size:12px}@media print{body{padding:24px}.draft{display:none}}`;
const wrap = (title, body) => `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}<script>window.onload=()=>window.print();<\/script></body></html>`;

// ---------- 급여 명세서 ----------
export function buildPayslipHtml(d) {
  const pays = d.pays.map((p) => `<tr><td>${esc(p.label)}</td><td class="r">${won(p.amount)}</td></tr>`).join("");
  const deds = d.deductions.filter((x) => num(x.amount) > 0).map((x) => `<tr><td>${esc(x.label)}</td><td class="r">${won(x.amount)}</td></tr>`).join("");
  const totalPay = d.pays.reduce((s, p) => s + num(p.amount), 0), totalDed = d.deductions.reduce((s, x) => s + num(x.amount), 0);
  return wrap(`급여 명세서 ${d.month} ${d.name}`, `<h1>${esc(d.month.replace("-", "년 "))}월 급여 명세서</h1>
    <table><tr><th style="width:90px">성명</th><td>${esc(d.name)}</td><th style="width:90px">사번</th><td>${esc(d.empId)}</td></tr>
    <tr><th>소속</th><td>${esc(d.branch)}</td><th>지급일</th><td>${esc(d.payDate || "-")}</td></tr></table>
    <h2>지급 내역</h2><table>${pays || `<tr><td colspan="2">내역 없음</td></tr>`}<tr class="total"><td>지급 합계</td><td class="r">${won(totalPay)}</td></tr></table>
    <h2>공제 내역</h2><table>${deds || `<tr><td colspan="2">공제 내역 없음</td></tr>`}<tr class="total"><td>공제 합계</td><td class="r">${won(totalDed)}</td></tr></table>
    <table><tr class="total"><td style="font-size:16px">실수령액</td><td class="r" style="font-size:16px">${won(totalPay - totalDed)}</td></tr></table>
    ${d.company ? `<p style="text-align:center;margin-top:30px">${esc(d.company)}</p>` : ""}`);
}

// ---------- 근로계약서 초안 ----------
export function buildContractHtml(d) {
  const info = COMPANY_INFO[d.company], stamp = info ? STAMP_IMAGES[info.stampKey] : "";
  const pay = d.pays.map((p) => `<tr><td>${esc(p.label)}</td><td class="r">월 ${won(p.amount)}</td></tr>`).join("");
  const term = d.endDate ? `${esc(fmtKo(d.startDate))} ~ ${esc(fmtKo(d.endDate))}` : `${esc(fmtKo(d.startDate))} 부터 (기간의 정함이 없음)`;
  return wrap(`근로계약서 ${d.name}`, `<h1>근 로 계 약 서</h1>
    <p>${esc(d.company || "사업주")} (이하 “사업주”)와 ${esc(d.name)} (이하 “근로자”)는 다음과 같이 근로계약을 체결한다.</p>
    <h2>1. 근로계약기간</h2><p>${term}${d.probationEnd ? `<br>수습기간: ${esc(fmtKo(d.startDate))} ~ ${esc(fmtKo(d.probationEnd))}` : ""}</p>
    <h2>2. 근무 장소</h2><p>${esc(d.branch)}</p>
    <h2>3. 업무 내용</h2><p>${esc(d.position || "")}${d.duties ? ` — ${esc(d.duties)}` : ""}</p>
    <h2>4. 소정근로시간</h2><p>${esc(d.workStart)} ~ ${esc(d.workEnd)} (휴게시간 ${esc(String(d.breakMin))}분)<br>근무일: ${esc(d.workDays)} / 주휴일: ${esc(d.weeklyHoliday)}</p>
    <h2>5. 임금</h2><table>${pay || `<tr><td colspan="2">(급여 정보 없음)</td></tr>`}</table>
    <p>지급일: ${esc(d.payDay)} / 지급방법: ${esc(d.payMethod)}${d.bank ? ` (${esc(d.bank)})` : ""}</p>
    <h2>6. 연차유급휴가</h2><p>근로기준법에서 정하는 바에 따라 부여한다.</p>
    <h2>7. 사회보험 적용</h2><p>고용보험, 산재보험, 국민연금, 건강보험 (해당 요건 충족 시 가입)</p>
    <h2>8. 기타</h2><p>이 계약에 정함이 없는 사항은 근로기준법 등 관계 법령에 따른다.${d.extra ? `<br>${esc(d.extra).replace(/\n/g, "<br>")}` : ""}</p>
    <p style="text-align:center;margin-top:30px">${esc(fmtKo(d.signDate))}</p>
    <div class="sign"><div><b>(사업주)</b><br>${esc(d.company)}<br>${esc(info?.address || d.addr || "")}<br>대표자 ${esc(info?.ceo || d.ceo || "")} <span class="stamp">(인)${stamp ? `<img src="${stamp}">` : ""}</span></div>
    <div><b>(근로자)</b><br>성명 ${esc(d.name)}<br>주소 ${esc(d.address || "")}<br>서명 ____________ (인)</div></div>
    <div class="draft">※ 이 문서는 입력한 정보로 만든 초안입니다. 실제 사용 전에 노무사·변호사의 검토를 받으세요. (이 안내는 인쇄되지 않습니다)</div>`);
}

function openPrint(html) {
  const w = window.open("", "_blank");
  if (!w) return toast("팝업이 차단됐습니다. 팝업을 허용한 뒤 다시 시도하세요.", true);
  w.document.write(html); w.document.close();
}

// ---------- 직원 상세에서 쓰는 화면 ----------
let cur = null;
export function severanceLine(emp, comp, resignDate) {
  const r = severanceEstimate(emp, comp, today(), resignDate);
  if (!r.ok) return `<span class="sub">퇴직금 예상: ${esc(r.reason)}</span>`;
  if (!r.eligible) return `<span class="sub">퇴직금 예상: ${esc(r.reason)} (재직 ${r.days}일)</span>`;
  return `<span class="sub">${resignDate ? `퇴직일(${esc(resignDate)}) 기준` : "오늘 퇴직 시"} 퇴직금 예상 <b>${won(r.amount)}</b> (재직 ${r.days}일 · 1일 평균임금 약 ${won(r.daily)}). 월 고정급만으로 어림한 값이며 상여금·연차수당은 제외했습니다.</span>`;
}
export function openPayslip(ctx) {
  cur = ctx; const { emp, comp } = ctx;
  const fi = fixedItems(comp);
  document.getElementById("psMonth").value = today().slice(0, 7);
  document.getElementById("psPayDate").value = "";
  document.getElementById("psCompany").value = corpName(emp.corp);
  document.getElementById("psExtraLabel").value = ""; document.getElementById("psExtra").value = "";
  ["psPension", "psHealth", "psCare", "psEmp", "psTax", "psLocal", "psOtherDed"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("psPays").innerHTML = fi.rows.map((r) => `<div class="sub">${esc(r.label)} ${won(r.amount)}</div>`).join("") || `<div class="sub">급여 정보가 없습니다. 아래에서 직접 추가하세요.</div>`;
  document.getElementById("psErr").textContent = "";
  document.getElementById("dlgPayslip").showModal();
}
export function openContract(ctx) {
  cur = ctx; const { emp, pi } = ctx, g = (id) => document.getElementById(id);
  g("ctStart").value = pi.workStartDate || emp.joinedAt || ""; g("ctEnd").value = emp.contractEndDate || "";
  g("ctProb").value = emp.probationEndDate || ""; g("ctDuties").value = ""; g("ctSign").value = today();
  g("ctCompany").value = corpName(emp.corp); g("ctExtra").value = ""; document.getElementById("dlgContract").showModal();
}
export function bindPayroll() {
  const g = (id) => document.getElementById(id);
  g("btnPsCancel").onclick = () => g("dlgPayslip").close();
  g("btnCtCancel").onclick = () => g("dlgContract").close();
  g("btnPsGo").onclick = () => {
    const { emp, comp } = cur, month = g("psMonth").value;
    if (!/^\d{4}-\d{2}$/.test(month)) return (g("psErr").textContent = "귀속 월을 선택하세요.");
    const pays = fixedItems(comp).rows.map((r) => ({ ...r }));
    if (num(g("psExtra").value) > 0) pays.push({ label: g("psExtraLabel").value.trim() || "추가 지급", amount: num(g("psExtra").value) });
    const deductions = [["국민연금", "psPension"], ["건강보험", "psHealth"], ["장기요양보험", "psCare"], ["고용보험", "psEmp"], ["소득세", "psTax"], ["지방소득세", "psLocal"], ["기타 공제", "psOtherDed"]].map(([label, id]) => ({ label, amount: num(g(id).value) }));
    openPrint(buildPayslipHtml({ month, name: emp.name, empId: emp.id, branch: cur.branch, payDate: g("psPayDate").value, pays, deductions, company: g("psCompany").value }));
    cur.audit?.("payslip", `${month} 급여 명세서`); g("dlgPayslip").close();
  };
  g("btnCtGo").onclick = () => {
    const { emp, comp, pi } = cur;
    if (!g("ctStart").value) return toast("계약 시작일을 입력하세요.", true);
    const info = COMPANY_INFO[g("ctCompany").value];
    openPrint(buildContractHtml({
      name: emp.name, address: pi.address || "", company: g("ctCompany").value, ceo: info?.ceo, addr: info?.address,
      startDate: g("ctStart").value, endDate: g("ctEnd").value, probationEnd: g("ctProb").value, branch: cur.branch, position: emp.position || "", duties: g("ctDuties").value.trim(),
      workStart: g("ctWorkStart").value, workEnd: g("ctWorkEnd").value, breakMin: g("ctBreak").value, workDays: g("ctWorkDays").value, weeklyHoliday: g("ctHoliday").value,
      pays: fixedItems(comp).rows, payDay: g("ctPayDay").value, payMethod: g("ctPayMethod").value, bank: pi.bankAccount || "", extra: g("ctExtra").value.trim(), signDate: g("ctSign").value || today(),
    }));
    cur.audit?.("contract_draft", "근로계약서 초안"); g("dlgContract").close();
  };
}
