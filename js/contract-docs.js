// 온라인 계약서·동의서 3종 (근로계약서 · 개인정보 수집·이용 동의서 · 서약서) — 정의와 인쇄용 문서 만들기 (순수 함수, 화면·Firebase 없이 테스트 가능)
//
// 항목은 두 가지로 나눈다.
//   · 노랑(y): 직원·계약마다 새로 적는 칸 (성명·생년월일·주소·계약 시작일·월 지급액·체결일 …)
//   · 주황(o): 기본 문구·숫자가 들어 있고 필요할 때만 바꾸는 옵션 (사용자 정보, 수습, 인센티브, 식대, 근로시간, 휴게, 사직 통보 일수, 문구 …)
// 첨부 양식(근로계약서 xlsx · 개인정보 동의서 docx · 서약서 docx)의 문구를 그대로 쓰고, 바꿀 수 있는 부분만 항목으로 뺐다.
import { COMPANY_INFO, STAMP_IMAGES, corpName } from "./company.js";

export const DOC_TYPES = {
  labor:   { title: "근로계약서",                  coll: "laborContracts", needs: "comp" },   // 급여가 들어 있어 ‘급여 정보’ 권한자만
  consent: { title: "개인정보 수집·이용 동의서",   coll: "contracts" },
  pledge:  { title: "서약서",                      coll: "contracts" },
};

const T = (key, label, grp, extra = {}) => ({ key, label, grp, type: "text", ...extra });

// type: text | date | number | textarea | check | select
export const FIELDS = {
  labor: [
    T("name", "근로자 성명", "y", { req: true }), T("birth", "생년월일", "y", { type: "date" }), T("address", "근로자 주소", "y", { wide: true }),
    T("startDate", "계약 시작일", "y", { type: "date", req: true }), T("endDate", "계약 종료일 (없으면 비움)", "y", { type: "date" }),
    T("monthlyPay", "월 지급액 (원)", "y", { type: "number", req: true }),
    T("mealChoice", "식대·중식 선택", "y", { type: "select", options: [["", "(선택 안 함 — 빈칸으로 표시)"], ["meal", "식대 제공"], ["lunch", "중식 제공"]] }),
    T("signDate", "계약 체결일", "y", { type: "date", req: true }),

    T("company", "사용자 상호", "o"), T("ceo", "대표자", "o"), T("companyAddr", "사용자 주소", "o", { wide: true }),
    T("place", "근로장소", "o"), T("duties", "담당업무", "o", { wide: true }),
    T("probOn", "수습 기간 문구 넣기", "o", { type: "check" }), T("probMonths", "수습 기간 (개월)", "o", { type: "number" }),
    T("payCalc", "급여 계산·지급일 문구", "o", { type: "textarea", wide: true }),
    T("incentiveOn", "인센티브 조항 넣기", "o", { type: "check" }), T("incentiveHead", "인센티브 기준 인원 (명 초과)", "o", { type: "number" }), T("incentiveAmt", "인원당 인센티브 (원)", "o", { type: "number" }),
    T("mealOn", "식대·중식 조항 넣기", "o", { type: "check" }), T("mealAmt", "식대 (원)", "o", { type: "number" }),
    T("weekdayLabel", "평일 표시", "o"), T("weekdayStart", "평일 근로 시작", "o", { type: "time" }), T("weekdayEnd", "평일 근로 종료", "o", { type: "time" }),
    T("satOn", "토요일 근로 넣기", "o", { type: "check" }), T("satLabel", "토요일 표시", "o"), T("satStart", "토요일 근로 시작", "o", { type: "time" }), T("satEnd", "토요일 근로 종료", "o", { type: "time" }),
    T("breakText", "휴게시간 (분·시간대)", "o"),
    T("holidayText", "휴일 조항", "o", { type: "textarea", wide: true }),
    T("noticeOn", "특기사항(퇴사 통보) 넣기", "o", { type: "check" }), T("noticeDays", "퇴사 예정 통보 (일 전)", "o", { type: "number" }),
    T("terminateDays", "계약 해지 사전 통보 (일 전)", "o", { type: "number" }),
    T("extra", "추가 특약·기타 (있을 때만)", "o", { type: "textarea", wide: true }),
  ],
  consent: [
    T("name", "성명", "y", { req: true }), T("agree", "동의 여부", "y", { type: "select", options: [["", "(선택 안 함 — 빈칸으로 표시)"], ["agree", "동의함"], ["disagree", "동의하지 않음"]] }),
    T("signDate", "작성일", "y", { type: "date", req: true }),
    T("company", "회사명", "o"),
    T("items", "수집하는 개인정보 항목", "o", { type: "textarea", wide: true }),
    T("purpose", "수집 및 이용 목적", "o", { type: "textarea", wide: true }),
    T("period", "보유 및 이용 기간", "o", { type: "textarea", wide: true }),
  ],
  pledge: [
    T("name", "성명", "y", { req: true }), T("birth", "생년월일", "y", { type: "date" }), T("address", "주소", "y", { wide: true }), T("dept", "부서명", "y"),
    T("confirm", "‘확인하였습니다’ 체크", "y", { type: "check" }), T("signDate", "작성일", "y", { type: "date", req: true }),
    T("company", "회사명", "o"),
  ],
};

export const LABOR_DEFAULT = {
  place: "본점 또는 지점", duties: "교육, 상담, 환경구성, 커리큘럼 제작 등", probOn: true, probMonths: 2,
  payCalc: "급여는  매월 1일에서 매월 말일까지 계산하여 익월 10일 지급한다.", incentiveOn: true, incentiveHead: 42, incentiveAmt: 30000,
  mealOn: true, mealAmt: 200000, weekdayLabel: "평일: 화-금", weekdayStart: "11:00", weekdayEnd: "20:00",
  satOn: true, satLabel: "주말: 토", satStart: "09:00", satEnd: "18:00", breakText: "60분(12:30~13:30)",
  holidayText: "설연휴(3일), 추석연휴(3일), 주휴일(월요일, 전주 만근한 경우에 한하여 유급으로 한다)", noticeOn: true, noticeDays: 60, terminateDays: 30, extra: "",
};
export const CONSENT_DEFAULT = {
  company: "㈜자라다교육",
  items: "입사자 인사정보 및 근로계약에 관한 정보\n(성명,사진,성별,주소 및 우편번호,이메일주소,전화번호,학력사항,외국어 능력,경력사항,자격사항,병역사항,국가보훈대상자 여부,현재연봉 및 기대연봉,입사가능일,특기,취미,본인장.단점 외 입사와 관련하여 회사에 제출하는 서류-이력서,자격증,증명서,추천서,성적성명서 등)에 기재된 개인정보 일체)",
  purpose: "제공하신 정보는 입사 전형 진행, 검토, 자격요건의 확인, 근무자 관련 서류 보관, 채용 관련 안내, 채용 여부의 검토 등을 위해 수집\n① 관련법률 : 근로기준법 제39조, 제42조, 동법 시행령 제19조\n② 퇴사 후 3년까지 근로기준법 제42조 의거 3년 의무 보유기간 경과 후 증명서 발급을 위하여 정보 수집 이용\n③ 단, 이용자와의 기본적 인권침해의 우려가 있는 민감한 개인정보(개인건강사항, 정치적 성향, 민감정보 등)는 보관하지 않습니다.",
  period: "수집된 개인정보의 보유기간은 퇴사 후 3년이 지난 시점부터 개인정보주체가 별도 요청이 있을 때 까지 보유합니다. 또한 파기 요청을 받을 경우 {회사}은 사용자의 개인정보를 재생이 불가능한 방법으로 즉시 파기합니다.",
};
export const PLEDGE_DEFAULT = { company: "(주)자라다교육" };

// 직원 정보로 미리 채운 기본값. ctx: { emp, pi, comp, today }
export function defaultsFor(type, ctx = {}) {
  const emp = ctx.emp || {}, pi = ctx.pi || {}, today = ctx.today || "";
  const base = { name: emp.name || "", birth: emp.birthDate || "", address: pi.address || "", signDate: today };
  if (type === "labor") {
    const corp = corpName(emp.corp) || "(주)제이드에듀", info = COMPANY_INFO[corp] || {};
    const total = Number(ctx.payTotal) || 0;
    return { ...base, ...LABOR_DEFAULT, startDate: pi.workStartDate || emp.joinedAt || "", endDate: emp.contractEndDate || "", monthlyPay: total ? String(total) : "", mealChoice: "",
      company: corp, ceo: info.ceo || "", companyAddr: info.address || "" };
  }
  if (type === "consent") return { name: base.name, agree: "", signDate: today, ...CONSENT_DEFAULT };
  return { ...base, dept: "", confirm: false, ...PLEDGE_DEFAULT };
}

// ---------- 인쇄용 HTML ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (s) => esc(s).replace(/\n/g, "<br>");
const dot = (d) => (d ? String(d).replace(/-/g, ".") : "");
const won = (n) => (Number(n) ? Number(n).toLocaleString("ko-KR") : "");
const hhmm = (t) => (t || "");
const bool = (v) => v === true || v === "true" || v === "on";
const fill = (s, v) => String(s ?? "").replace(/\{회사\}/g, v.company || "회사");

const CSS = `@page{size:A4;margin:14mm}body{font-family:"Malgun Gothic","Pretendard",sans-serif;color:#000;font-size:11.5px;line-height:1.55;margin:0;padding:18px}
h1{text-align:center;font-size:21px;letter-spacing:6px;margin:0 0 14px}table{width:100%;border-collapse:collapse}td,th{border:1px solid #000;padding:5px 8px;vertical-align:middle;text-align:left}
th{background:#f2f2f2;font-weight:600;text-align:center;white-space:nowrap}.c{text-align:center}.r{text-align:right}.nb td,.nb th{border:0}.pre{white-space:pre-line}
.lead{margin:12px 0;text-align:center}ol.cl{margin:0;padding-left:20px}ol.cl li{margin:2px 0}.sign{display:flex;justify-content:space-between;gap:24px;margin-top:20px}.sign>div{flex:1;line-height:2}
.stamp{position:relative;display:inline-block;width:58px;height:40px;text-align:center;vertical-align:middle}.stamp img{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56px;mix-blend-mode:multiply}
.box{border:1px solid #000;padding:8px 10px;margin:8px 0}.date{text-align:center;margin:20px 0}.small{font-size:10.5px}
@media print{body{padding:0}}`;
const wrap = (title, body, { autoPrint = true } = {}) => `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}${autoPrint ? `<script>window.onload=()=>window.print();<\/script>` : ""}</body></html>`;

function laborBody(v) {
  const info = COMPANY_INFO[v.company], stamp = info ? STAMP_IMAGES[info.stampKey] : "";
  const probOn = bool(v.probOn), incOn = bool(v.incentiveOn), mealOn = bool(v.mealOn), satOn = bool(v.satOn), noticeOn = bool(v.noticeOn);
  // 계약기간
  const term = `근로계약 ${esc(dot(v.startDate))} 부터${v.endDate ? ` ${esc(dot(v.endDate))} 까지` : ""}`;
  const prob = probOn ? `<ol class="cl"><li>${esc(v.probMonths)}개월의 수습 기간 후 정규직 전환, 수습기간동안은 3.3%의 소득세 공제, 정규직 전환 시 4대보험 적용함.</li></ol>` : "";
  // 급여 조항 (번호는 넣은 조항만 순서대로)
  const pay = [nl(v.payCalc), "1개월 미만의 경우에는 근무일수에 비례하여 지급한다.", "퇴직금은 근로자퇴직급여보장법에 의한다.",
    "상기 수당외 그 밖에 상여금은 명절, 추석명절, 하계휴가 등에 회사의 사정에 따라 지급할 수 있다."];
  if (incOn) pay.push(`담당인원이 ${esc(v.incentiveHead)}명을 초과하는 경우 인원당 ${won(v.incentiveAmt)}원의 인센티브를 지급한다.`);
  if (mealOn) pay.push(`식대 ${won(v.mealAmt)}원 또는 중식 제공 중 선택한다. 식대 제공( ${v.mealChoice === "meal" ? "○" : "&nbsp;&nbsp;&nbsp;"} ), 중식 제공( ${v.mealChoice === "lunch" ? "○" : "&nbsp;&nbsp;&nbsp;"} )`);
  const hours = [
    `${esc(v.weekdayStart ? hhmm(v.weekdayStart) : "")} ~ ${esc(hhmm(v.weekdayEnd))} (${esc(String(v.weekdayLabel || "").replace(/^평일:\s*/, "평일: "))})`,
    ...(satOn ? [`${esc(hhmm(v.satStart))} ~ ${esc(hhmm(v.satEnd))} (${esc(String(v.satLabel || "").replace(/^주말:\s*/, "주말: "))})`] : []),
  ];
  const notice = noticeOn ? `퇴사예정시 교사 직무 특성상 후임자 교육 및 인수인계 시간이 필요하여 퇴사 예정일 ${esc(v.noticeDays)}일 이전에 서면으로 제출한다.<br>만약 퇴사예정일 ${esc(v.noticeDays)}일 이전에 서면 통보 없이 퇴사할 경우 발생하는 회사의 손해에 대해서는 민,형사상의 책임을 진다.` : "";
  const dismiss = ["1개월간 무단 결근일수가 계속해서 3일 이상이거나 누적해서 5일 이상인 경우", "근무성적 또는 능률이 불량한 자로 취업이 부당하다고 인정되어 개선의 가망이 없다고 인정되는 경우",
    "건강상의 사유로 인하여 업무를 감당할 수 없다고 인정되는 경우", "형사사건으로 기소되어 형의 선고를 받았거나 범법행위를 하여 형사상 소추를 받은 경우", "직무상 고의 또는 과실로 인하여 회사에 피해가 발생되었다고 판명될 때",
    "회사의 운영상 감원을 필요로 할 때", "기타 사회통념상 근로관계를 계속 유지할 수 없다고 인정 되는 때", "근무 중 습득한 업무상 기술 및 원의 영업비밀에 속하는 사항을 사용자의 허가 없이 공개 및 누설하는 경우"];
  const etc = ["본 계약서 상에 명시되지 않은 사항은 근로기준법 및 취업규칙에 따른다.",
    `계약기간 중 일방이 계약해지를 하고자 하는 경우 ${esc(v.terminateDays)}일 이전에 사전 통보함으로써 그 효력을 발휘하며, 이를 위반하는 자는 계약위반에 대한 민·형사상 및 행정상(노동관계법 포함) 일체의 손해배상 책임을 진다.`,
    "본 근로계약의 체결을 증명하기 위하여 계약서 2통을 작성하여 쌍방 서명 날인하고 각각 1통씩 보관한다."];
  const row = (head, body) => `<tr><th style="width:84px">${head}</th><td>${body}</td></tr>`;
  return `<h1>근 로 계 약 서</h1>
  <table>
    <tr><th rowspan="2" style="width:70px">사용자</th><th style="width:60px">상호</th><td>${esc(v.company)}</td><th style="width:50px">대표</th><td>${esc(v.ceo)}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(v.companyAddr)}</td></tr>
    <tr><th rowspan="2">근로자</th><th>성명</th><td>${esc(v.name)}</td><th>생년월일</th><td>${esc(dot(v.birth))}</td></tr>
    <tr><th>주소</th><td colspan="3">${esc(v.address)}</td></tr>
  </table>
  <p class="lead">아래의 근로조건을 성실히 이행할 것을 약정하고 근로계약을 체결한다.<br>- 아&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;래 -</p>
  <table>
    <tr><th style="width:84px">근로장소</th><td>${esc(v.place)}</td><th style="width:70px">담당업무</th><td>${esc(v.duties)}</td></tr>
    <tr><th>계약기간</th><td colspan="3">${term}${prob}</td></tr>
    <tr><th>급여내역</th><td colspan="3"><b>월 지급액 ${won(v.monthlyPay)}원</b><br>근로자의 포괄 시급여는 위와 같고, 주휴수당을 포함한 금액으로 세부내역은 아래와 같다. 급여는 매월 근로소득세, 고용보험료 등을 원천징수한 후 지급한다.
      <ol class="cl">${pay.map((p) => `<li>${p}</li>`).join("")}</ol></td></tr>
    <tr><th>근로시간<br>및<br>휴게시간</th><td colspan="3"><ol class="cl">
      <li>근로 : ${hours.join("<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;")}</li>
      <li>휴게 : 근무시간 중 ${esc(v.breakText)}을 휴게시간으로 부여한다.</li>
      <li>근로시간은 휴게시간을 제외하고 1일 8시간, 1주 40시간을 원칙으로 하되, 근로기준법에 따라 1주일에 12시간 한도로 연장근로를 실시할 수 있음에 동의하며 “갑”은 “을”에게 업무상의 필요에 의하여, 연장근로, 야간근로 및 휴일근로를 명할 수 있으며 “을”은 이에 포괄적으로 합의한 것으로 본다.</li>
      <li>사용자는 제1항의 소정근로시간 외 연장, 야간 및 휴일근로가 발생한 경우 근로기준법 제57조(보상휴가제)에 따라 근로자대표와의 서면합의를 통해 임금을 지급하는 것을 갈음하여 휴가를 줄 수 있다.</li>
      <li>사용자는 업무상 필요한 경우 제1항의 근로시간 범위내에서 근로자의 근무일 및 근무시간을 조정할 수 있다.</li>
      <li>근로기준법에 의해 연차휴가를 부여하여 사용함을 원칙으로 한다. 단, 취업규칙에서 정한 날은 연차유급휴가로 대체하여 사용한다. 기타 연차휴가에 관한 사항은 근로기준법 등에 따른다.<br>근로기준법 제61조(연차 유급휴가의 사용촉진)을 시행한다</li>
      <li>${nl(v.holidayText)}</li></ol></td></tr>
    ${notice ? row("특기사항", notice) : ""}
    <tr><th>근로계약<br>해지사유</th><td colspan="3">"사용자"는 다음과 같은 사유가 있는 경우 근로계약을 해지하며 당연 퇴직된다.<ol class="cl">${dismiss.map((d) => `<li>${d}</li>`).join("")}</ol></td></tr>
    <tr><th>기타<br>근로조건</th><td colspan="3"><ol class="cl">${etc.map((d) => `<li>${d}</li>`).join("")}${v.extra ? `<li class="pre">${nl(v.extra)}</li>` : ""}</ol></td></tr>
  </table>
  <p class="date">${esc(dot(v.signDate))}</p>
  <div class="sign"><div><b>( 사 용 자 )</b><br>${esc(v.company)}<br>대표이사 ${esc(v.ceo)} <span class="stamp">(인)${stamp ? `<img src="${stamp}" alt="">` : ""}</span></div>
  <div><b>( 근 로 자 )</b><br>성명 ${esc(v.name)} <span style="margin-left:14px">(인)</span><br>생년월일 ${esc(dot(v.birth))}</div></div>`;
}

function consentBody(v) {
  const co = v.company || "회사", mark = (on) => (on ? "☑" : "□");
  return `<h1 style="letter-spacing:2px">개인정보 수집·이용 동의서</h1>
  <table>
    <tr><th style="width:130px">수집하는<br>개인정보항목</th><td class="pre">${nl(v.items)}</td></tr>
    <tr><th>개인정보의<br>수집 및 이용목적</th><td class="pre">${nl(v.purpose)}</td></tr>
    <tr><th>개인정보의<br>보유 및 이용기간</th><td class="pre">${nl(fill(v.period, v))}</td></tr>
    <tr><td colspan="2">※ 귀하는 이에 대한 동의를 거부할 수 있으며, 다만 이에 동의하지 않을 경우 회사와의 근로계약의 체결이 불가능할 수 있습니다.</td></tr>
  </table>
  <p class="c" style="margin:16px 0"><b>개인정보 수집 및 이용에 동의함 ${mark(v.agree === "agree")} &nbsp;&nbsp; 개인정보 수집 및 이용에 동의하지 않음 ${mark(v.agree === "disagree")}</b></p>
  <p class="small">※ 개인정보 제공자가 동의한 내용 외의 다른 목적으로 활용하지 않으며 제공된 개인정보를 변경하고자 할 때에는 개인정보취급자를 통해 열람, 정정을 요구할 수 있음.</p>
  <p class="date">${esc(dot(v.signDate)) || "20&nbsp;&nbsp;&nbsp;&nbsp;.&nbsp;&nbsp;&nbsp;.&nbsp;&nbsp;&nbsp;."}</p>
  <p class="r" style="margin-right:30px">성명 ${esc(v.name)} &nbsp;&nbsp;&nbsp;&nbsp; (인)</p>
  <p style="margin-top:30px"><b>${esc(co)} 귀하</b></p>`;
}

function pledgeBody(v) {
  const co = v.company || "회사";
  const secrets = ["회사의 사업계획, 사업추진 방향 등에 대한 내용", "서비스의 방법 등 경영정보 일체에 관한 내용", "인사, 조직, 재무, 전산 등 관리에 관한 내용", "타사와의 제휴 사업에 관한 내용",
    "회사에서 기획, 생산 및 제공하는 교재 등 모든 교보재에 대한 내용", "업무상 발생하는 유관업체 또는 기관과의 사업정보 또는 협의내용", "회사 임직원의 활동과 그에 수반되는 부수 내용 및 기타 원 측이 영업비밀로 인정한 일체의 사항",
    "회사의 임직원, 고객, 회원, 타사 직원 등의 개인정보에 관한 사항", "기타 계약이행 중 또는 이행과 관계없이 알게 된 회사와 관련된 제반사항"];
  return `<h1 style="letter-spacing:8px">서 약 서</h1>
  <table>
    <tr><th style="width:90px">주 소</th><td colspan="3">${esc(v.address)}</td></tr>
    <tr><th>성 명</th><td>${esc(v.name)}</td><th style="width:90px">부 서 명</th><td>${esc(v.dept)}</td></tr>
    <tr><th>생 년 월 일</th><td colspan="3">${esc(dot(v.birth))}</td></tr>
  </table>
  <p style="margin:12px 0">상기 본인은 ${esc(co)}[이하 ‘회사’]에 직원으로 근무하는 도중은 물론, 퇴사 이후에도 이하의 모든 사항을 준수할 것을 서약합니다. 본 서약서를 위반할 경우 제반 관련법규에 따른 민형사상 책임 등을 지고 회사의 금전적 손해에 대한 손해를 배상하며, 관련 법과 회사의 제규정에 의한 어떠한 조치도 감수할 것을 서약합니다.</p>
  <ol style="padding-left:20px;margin:0">
    <li>회사의 업무지시, 인사 발령 등 모든 규정을 잘 이행하겠습니다.</li>
    <li>근무 중에 습득한 업무상의 기술 및 원의 영업 비밀에 속하는 다음 사항을 회사의 허가 없이 사용하거나, 그 누구에도 공개하거나 누설하지 않겠습니다.
      <ol style="padding-left:20px;list-style:none;margin:2px 0">${secrets.map((s, i) => `<li>${i + 1}) ${s}</li>`).join("")}</ol></li>
    <li>재직 시는 물론 퇴사 후에도 회사의 업무와 관련하여 취득하게 된 영업 비밀을 가지고 창업을 하거나 경쟁 회사로의 전직 또는 동업을 하지 않겠습니다.</li>
    <li>퇴사 후 회사의 임직원을 경쟁업체로의 이직권유나 이직 주선행위를 하지 않겠습니다.</li>
    <li>회사에서 구매한 응용프로그램 및 비품 등을 회사 밖으로 일체 유출하지 않겠습니다.</li>
    <li>회사에서 근무 중 작성한 각종 서류 및 PC에 보관된 일체의 자료를 허가 없이 외부로 유출 또는 일시 반출도 하지 않으며, 퇴사 시 전부 반납하겠으며, 반납이 어려울 경우 회사와 협의하여 파기하고, 이에 관한 어떠한 형태의 사본도 보유하지 않겠습니다.</li>
    <li>본인은 상기 회사에서 배운 교육방식은 영업비밀로 제정되어 특허청에 보관중임을 인지하고 있습니다. ${bool(v.confirm) ? "☑" : "□"} 확인하였습니다.</li>
  </ol>
  <p class="date">${esc(dot(v.signDate)) || "20&nbsp;&nbsp;&nbsp;&nbsp;년&nbsp;&nbsp;&nbsp;월&nbsp;&nbsp;&nbsp;일"}</p>
  <p class="r" style="margin-right:30px">서약인 : ${esc(v.name)} &nbsp;&nbsp;&nbsp;&nbsp; (인)</p>
  <p style="margin-top:28px"><b>${esc(co)} 대표이사 귀하</b></p>`;
}

// 문서 → 인쇄용 전체 HTML (autoPrint=false 면 인쇄 창을 자동으로 띄우지 않는다)
export function buildDocHtml(type, v, opts) {
  const t = DOC_TYPES[type]; if (!t) throw new Error("알 수 없는 문서 종류: " + type);
  const body = type === "labor" ? laborBody(v) : type === "consent" ? consentBody(v) : pledgeBody(v);
  return wrap(`${t.title} ${v.name || ""}`.trim(), body, opts);
}

// 필수(노랑) 칸이 비어 있으면 알려 준다
export function missingRequired(type, v) {
  return FIELDS[type].filter((f) => f.req && !String(v[f.key] ?? "").trim()).map((f) => f.label);
}

// 저장·불러오기용: 화면 입력값을 문자열·숫자·불리언으로 정리
export function cleanValues(type, raw) {
  const out = {};
  for (const f of FIELDS[type]) {
    const x = raw[f.key];
    if (f.type === "check") out[f.key] = bool(x);
    else if (f.type === "number") { const n = String(x ?? "").replace(/[^\d.-]/g, ""); out[f.key] = n === "" ? "" : Number(n); }
    else out[f.key] = String(x ?? "").slice(0, f.type === "textarea" ? 2000 : 300);
  }
  return out;
}
