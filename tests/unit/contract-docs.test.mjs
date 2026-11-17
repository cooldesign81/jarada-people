import { DOC_TYPES, FIELDS, defaultsFor, buildDocHtml, missingRequired, cleanValues, signAnswerFields, signedValues, signMeta } from "../../js/contract-docs.js";
let f = 0; const ok = (n, c, extra = "") => { if (!c) f++; console.log(c ? "PASS" : "FAIL", n, c ? "" : extra); };
const emp = { name: "김효진", birthDate: "1990-05-21", joinedAt: "2026-03-02", corp: "jade" }, pi = { address: "경기도 군포시 산본동 78-32" };

// 종류·항목 구성: 노랑(y)은 직원마다, 주황(o)은 기본값이 있는 옵션
ok("문서 3종", Object.keys(DOC_TYPES).join() === "labor,consent,pledge");
for (const t of Object.keys(FIELDS)) ok(`${t}: 노랑 칸이 있음`, FIELDS[t].some((x) => x.grp === "y"));
ok("근로계약서·동의서에는 주황 옵션이 있음", FIELDS.labor.some((x) => x.grp === "o") && FIELDS.consent.some((x) => x.grp === "o"));
ok("근로계약서만 급여 권한(comp)이 필요", DOC_TYPES.labor.needs === "comp" && !DOC_TYPES.consent.needs && !DOC_TYPES.pledge.needs);

// 기본값: 직원 정보로 미리 채움
const L = defaultsFor("labor", { emp, pi, today: "2026-04-15", payTotal: 2400000 });
ok("근로계약서 기본값: 직원·회사·급여", L.name === "김효진" && L.birth === "1990-05-21" && L.address.includes("산본동") && L.startDate === "2026-03-02" && L.company === "(주)제이드에듀" && L.ceo && L.monthlyPay === "2400000" && L.signDate === "2026-04-15");
ok("근로계약서 기본 옵션(첨부 양식 값)", L.probMonths === 2 && L.incentiveHead === 42 && L.incentiveAmt === 30000 && L.mealAmt === 200000 && L.noticeDays === 60 && L.terminateDays === 30 && L.weekdayStart === "11:00" && L.weekdayEnd === "20:00" && L.satStart === "09:00" && L.satEnd === "18:00");
const peak = defaultsFor("labor", { emp: { ...emp, corp: "peak" }, pi, today: "2026-04-15" });
ok("법인에 따라 사용자 정보가 바뀜", peak.company === "피크코퍼레이션(주)" && peak.ceo !== L.ceo && peak.monthlyPay === "");

// 근로계약서 본문
const h = buildDocHtml("labor", { ...L, startDate: "2026-04-15" });
ok("근로계약서: 제목·사용자·근로자", h.includes("근 로 계 약 서") && h.includes("(주)제이드에듀") && h.includes("김효진") && h.includes("1990.05.21") && h.includes("산본동"));
ok("근로계약서: 계약기간·수습", h.includes("근로계약 2026.04.15 부터") && h.includes("2개월의 수습 기간 후 정규직 전환"));
ok("근로계약서: 월 지급액", h.includes("월 지급액 2,400,000원"));
ok("근로계약서: 인센티브·식대 조항", h.includes("42명을 초과하는 경우 인원당 30,000원") && h.includes("식대 200,000원 또는 중식 제공 중 선택한다"));
ok("근로계약서: 근로시간·휴게", h.includes("11:00 ~ 20:00 (평일: 화-금)") && h.includes("09:00 ~ 18:00 (주말: 토)") && h.includes("60분(12:30~13:30)을 휴게시간으로 부여한다"));
ok("근로계약서: 휴일·특기·해지", h.includes("주휴일(월요일") && h.includes("퇴사 예정일 60일 이전에 서면으로 제출한다") && h.includes("30일 이전에 사전 통보"));
ok("근로계약서: 첨부 양식의 오타(근로지기준법)는 바로잡음", h.includes("근로기준법 제61조") && !h.includes("근로지기준법"));
ok("근로계약서: 서명란과 직인", h.includes("( 사 용 자 )") && h.includes("( 근 로 자 )") && /<img src="data:image\/png/.test(h) && h.includes("2026.04.15"));
ok("인쇄 창 자동 인쇄 스크립트", h.includes("window.print()") && !buildDocHtml("labor", L, { autoPrint: false }).includes("window.print()"));

// 주황 옵션 켜고 끄기 / 값 바꾸기
const o = buildDocHtml("labor", { ...L, probOn: false, incentiveOn: false, mealOn: false, satOn: false, noticeOn: false, extra: "근무지 변경은 사전 합의한다." }, { autoPrint: false });
ok("옵션 끄기: 수습·인센티브·식대·토요일·특기사항이 빠짐", !o.includes("수습 기간 후") && !o.includes("인센티브를 지급한다") && !o.includes("식대 200,000원") && !o.includes("(주말: 토)") && !o.includes("특기사항"));
ok("추가 특약이 기타 근로조건에 들어감", o.includes("근무지 변경은 사전 합의한다."));
const o2 = buildDocHtml("labor", { ...L, probMonths: 3, incentiveHead: 30, incentiveAmt: 50000, mealAmt: 150000, mealChoice: "lunch", noticeDays: 30, terminateDays: 14, weekdayStart: "10:00", weekdayEnd: "19:00", breakText: "60분(13:00~14:00)", company: "피크코퍼레이션(주)" }, { autoPrint: false });
ok("옵션 값 바꾸기가 문서에 반영", o2.includes("3개월의 수습") && o2.includes("30명을 초과하는 경우 인원당 50,000원") && o2.includes("식대 150,000원") && o2.includes("중식 제공( ○ )") && o2.includes("퇴사 예정일 30일 이전") && o2.includes("14일 이전에 사전 통보") && o2.includes("10:00 ~ 19:00") && o2.includes("13:00~14:00") && o2.includes("피크코퍼레이션(주)"));
ok("조항 번호는 넣은 조항만 순서대로(인센티브·식대 끄면 4개)", ((o.match(/<ol class="cl"><li>급여는/g) || []).length === 1) && (o.split("급여내역")[1].split("</ol>")[0].match(/<li>/g) || []).length === 4);
ok("HTML 특수문자는 이스케이프", buildDocHtml("labor", { ...L, name: "<b>x</b>", duties: "a&b" }, { autoPrint: false }).includes("&lt;b&gt;x&lt;/b&gt;"));

// 개인정보 동의서
const C = defaultsFor("consent", { emp, pi, today: "2026-04-15" });
const ch = buildDocHtml("consent", { ...C, agree: "agree" }, { autoPrint: false });
ok("동의서: 제목·항목·목적·기간 문구", ch.includes("개인정보 수집·이용 동의서") && ch.includes("입사자 인사정보 및 근로계약에 관한 정보") && ch.includes("근로기준법 제39조") && ch.includes("㈜자라다교육은 사용자의 개인정보를"));
ok("동의서: 동의 선택에 따라 체크 표시", ch.includes("동의함 ☑") && ch.includes("동의하지 않음 □") && buildDocHtml("consent", { ...C, agree: "disagree" }, { autoPrint: false }).includes("동의하지 않음 ☑") && buildDocHtml("consent", C, { autoPrint: false }).includes("동의함 □"));
ok("동의서: 작성일·성명·회사 귀하", ch.includes("2026.04.15") && ch.includes("성명 김효진") && ch.includes("㈜자라다교육 귀하"));
ok("동의서: 회사명을 바꾸면 보유기간 문구에도 반영", buildDocHtml("consent", { ...C, company: "(주)제이드에듀" }, { autoPrint: false }).includes("(주)제이드에듀은 사용자의 개인정보를"));
ok("동의서: 작성일을 비우면 빈칸 양식", buildDocHtml("consent", { ...C, signDate: "" }, { autoPrint: false }).includes("20&nbsp;"));

// 서약서
const P = defaultsFor("pledge", { emp, pi, today: "2026-04-15" });
const ph = buildDocHtml("pledge", { ...P, dept: "평촌원", confirm: true }, { autoPrint: false });
ok("서약서: 제목·인적 사항", ph.includes("서 약 서") && ph.includes("산본동") && ph.includes("김효진") && ph.includes("평촌원") && ph.includes("1990.05.21"));
ok("서약서: 조항 7개와 영업비밀 9항목, 확인 체크", ph.includes("특허청에 보관중임") && ph.includes("☑ 확인하였습니다") && ph.includes("9) 기타 계약이행") && buildDocHtml("pledge", P, { autoPrint: false }).includes("□ 확인하였습니다"));
ok("서약서: 회사명 반영·서명", ph.includes("(주)자라다교육 대표이사 귀하") && ph.includes("서약인 : 김효진"));

// 필수 칸·값 정리
ok("필수 칸 점검", missingRequired("labor", { name: "", startDate: "", monthlyPay: "", signDate: "2026-04-15" }).length === 3 && missingRequired("labor", L).length === 0);
const cv = cleanValues("labor", { name: "홍", monthlyPay: "2,400,000원", probOn: "on", incentiveOn: false, mealOn: true, extra: "가".repeat(3000), 이상한키: "x" });
ok("값 정리: 숫자·체크·길이 제한·모르는 키 제거", cv.monthlyPay === 2400000 && cv.probOn === true && cv.incentiveOn === false && cv.mealOn === true && cv.extra.length === 2000 && !("이상한키" in cv));
// 한 장 맞춤(인쇄) · 전자서명
const pr = buildDocHtml("labor", L);
ok("인쇄용: 한 장 맞춤 스크립트·A4 여백", pr.includes('class="fit"') && pr.includes("__fitScale") && pr.includes("@page{size:A4;margin:10mm}") && pr.includes("window.print()"));
const pv = buildDocHtml("labor", L, { autoPrint: false });
ok("미리보기: 인쇄 창·한 장 맞춤 없이 글자만 줄임", !pv.includes("window.print()") && !pv.includes("__fitScale") && pv.includes(":root{--s:0.8}") && buildDocHtml("pledge", P, { autoPrint: false }).includes(":root{--s:1}"));
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const sg = buildDocHtml("labor", { ...L, mealChoice: "meal" }, { autoPrint: false, sign: { img: PNG, at: new Date(2026, 10, 17, 14, 3).getTime(), name: "김효진" } });
ok("전자서명: 서명 이미지·서명 시각·서명자 표시", sg.includes(`<img src="${PNG}" alt="서명">`) && sg.includes("전자서명 완료 · 2026.11.17 14:03 · 김효진") && !sg.includes('margin-left:14px">(인)'));
ok("서명 없으면 (인) 칸 유지", buildDocHtml("labor", L, { autoPrint: false }).includes('margin-left:14px">(인)') && !buildDocHtml("labor", L, { autoPrint: false }).includes("전자서명 완료"));
ok("동의서·서약서도 서명 이미지 반영", buildDocHtml("consent", C, { autoPrint: false, sign: { img: PNG, at: 0, name: "김효진" } }).includes(`src="${PNG}"`) && buildDocHtml("pledge", P, { autoPrint: false, sign: { img: PNG, at: 0, name: "x" } }).includes(`src="${PNG}"`));
ok("서명 때 직원이 답하는 항목", signAnswerFields("labor", { mealOn: true })[0].key === "mealChoice" && signAnswerFields("labor", { mealOn: false }).length === 0 && signAnswerFields("consent")[0].key === "agree" && signAnswerFields("pledge")[0].key === "confirm" && signAnswerFields("pledge")[0].type === "check");
const svv = signedValues({ data: { name: "홍", agree: "" }, answers: { agree: "agree" } });
ok("직원의 답이 문서 값에 합쳐짐", svv.agree === "agree" && svv.name === "홍" && buildDocHtml("consent", svv, { autoPrint: false }).includes("동의함 ☑"));
ok("signMeta", signMeta({ signature: PNG, data: { name: "홍" } }, 5).at === 5 && signMeta({ data: {} }, 5) === null);
console.log(f ? `\n${f} FAILURES` : "\nALL PASS"); process.exit(f ? 1 : 0);
