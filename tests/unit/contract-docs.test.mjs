import { DOC_TYPES, FIELDS, defaultsFor, buildDocHtml, missingRequired, cleanValues, signAnswerFields, signedValues, signMeta, CUSTOM_TEMPLATES, docTitle, SECURITY_DEFAULT, canonicalJson, sha256Hex, docHashOf, signedHashOf, maskPhone, toE164, CONTRACT_VERSION } from "../../js/contract-docs.js";
let f = 0; const ok = (n, c, extra = "") => { if (!c) f++; console.log(c ? "PASS" : "FAIL", n, c ? "" : extra); };
const emp = { name: "김효진", birthDate: "1990-05-21", joinedAt: "2026-03-02", corp: "jade" }, pi = { address: "경기도 군포시 산본동 78-32" };

// 종류·항목 구성: 노랑(y)은 직원마다, 주황(o)은 기본값이 있는 옵션
ok("문서 종류: 근로계약서·동의서·(이전 양식 서약서)·서약서(보안 수칙)·자유 서식", Object.keys(DOC_TYPES).join() === "labor,consent,pledge,security,custom");
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
ok("전자서명: 서명 이미지·서명 시각·서명자 표시", sg.includes(`<img src="${PNG}" alt="서명">`) && sg.includes("전자서명 완료 · 2026.11.17 14:03 · 김효진") && !sg.includes("(서명 또는 인)"));
ok("서명 전에는 테두리 서명란(서명 또는 인) 표시", buildDocHtml("labor", L, { autoPrint: false }).includes('<span class="sigbox">(서명 또는 인)</span>') && buildDocHtml("custom", { ...defaultsFor("custom", { emp, today: "2026-11-17" }), title: "t", body: "b" }, { autoPrint: false }).includes("sigbox") && !buildDocHtml("labor", L, { autoPrint: false }).includes("전자서명 완료"));
ok("동의서·서약서도 서명 이미지 반영", buildDocHtml("consent", C, { autoPrint: false, sign: { img: PNG, at: 0, name: "김효진" } }).includes(`src="${PNG}"`) && buildDocHtml("pledge", P, { autoPrint: false, sign: { img: PNG, at: 0, name: "x" } }).includes(`src="${PNG}"`));
ok("서명 때 직원이 답하는 항목", signAnswerFields("labor", { mealOn: true })[0].key === "mealChoice" && signAnswerFields("labor", { mealOn: false }).length === 0 && signAnswerFields("consent")[0].key === "agree" && signAnswerFields("pledge")[0].key === "confirm" && signAnswerFields("pledge")[0].type === "check");
const svv = signedValues({ data: { name: "홍", agree: "" }, answers: { agree: "agree" } });
ok("직원의 답이 문서 값에 합쳐짐", svv.agree === "agree" && svv.name === "홍" && buildDocHtml("consent", svv, { autoPrint: false }).includes("동의함 ☑"));
ok("signMeta", signMeta({ signature: PNG, data: { name: "홍" } }, 5).at === 5 && signMeta({ data: {} }, 5) === null);
// 자유 서식(서명 문서)
ok("자유 서식: 종류·저장 위치", DOC_TYPES.custom.coll === "contracts" && !DOC_TYPES.custom.needs && FIELDS.custom.filter((x) => x.req).map((x) => x.key).join() === "title,body,name,signDate");
ok("자유 서식: 양식 5종(빈 양식 + 4)", CUSTOM_TEMPLATES.length === 5 && CUSTOM_TEMPLATES[0].key === "blank" && CUSTOM_TEMPLATES.slice(1).every((t) => t.title && t.body));
const U = { ...defaultsFor("custom", { emp, today: "2026-11-17" }), title: "취업규칙 확인 및 동의서", body: CUSTOM_TEMPLATES[1].body };
ok("자유 서식 기본값: 이름·작성일·회사", U.name === "김효진" && U.signDate === "2026-11-17" && U.company === "(주)제이드에듀" && U.mode === "confirm");
const uh = buildDocHtml("custom", U, { autoPrint: false });
ok("자유 서식: 제목·본문({회사} 치환)·확인 체크 빈칸", uh.includes("<h1") && uh.includes("취업규칙 확인 및 동의서") && uh.includes("(주)제이드에듀의 취업규칙") && !uh.includes("{회사}") && uh.includes("□ 위 내용을 확인하였으며"));
ok("자유 서식: 직원이 확인하면 ☑", buildDocHtml("custom", { ...U, confirm: true }, { autoPrint: false }).includes("☑ 위 내용을 확인하였으며"));
ok("자유 서식: 동의 선택 방식", buildDocHtml("custom", { ...U, mode: "agree", agree: "disagree" }, { autoPrint: false }).includes("동의하지 않음 ☑") && signAnswerFields("custom", { mode: "agree" })[0].key === "agree" && signAnswerFields("custom", { mode: "confirm" })[0].key === "confirm");
ok("자유 서식: 본문은 이스케이프", !buildDocHtml("custom", { ...U, body: "<script>x</script>" }, { autoPrint: false }).includes("<script>x"));
ok("자유 서식: 본문 5000자까지 저장(칸 길이)", cleanValues("custom", { title: "t", body: "가".repeat(6000) }).body.length === 5000);
ok("docTitle: 자유 서식은 직접 쓴 제목", docTitle({ type: "custom", data: { title: "교육 이수 확인서" } }) === "교육 이수 확인서" && docTitle({ type: "labor" }) === "근로계약서" && docTitle({ type: "custom", data: {} }) === "서명 문서(자유 서식)");
// 서약서(정보보안 수칙)
const SE = defaultsFor("security", { emp, today: "2026-11-17" });
const seh = buildDocHtml("security", { ...SE, dept: "평촌원" }, { autoPrint: false });
ok("서약서(보안 수칙): 기본값(이름·회사·9개 수칙)", SE.name === "김효진" && SE.company === "(주)제이드에듀" && SECURITY_DEFAULT.rules.split("\n").length === 9 && SECURITY_DEFAULT.rules.startsWith("1. "));
ok("서약서(보안 수칙): 제목·인적 사항·수칙·확인 문구·서명란", seh.includes("서 약 서") && !seh.includes("확인서") && DOC_TYPES.security.title === "서약서" && seh.includes("평촌원") && seh.includes("9. 위 사항을 위반") && seh.includes("□ 위 정보보안 수칙을") && seh.includes("sigbox") && seh.includes("(주)제이드에듀 대표이사 귀하"));
ok("보안 수칙: 직원이 서약하면 ☑ + 서명 항목", buildDocHtml("security", { ...SE, confirm: true }, { autoPrint: false }).includes("☑ 위 정보보안 수칙을") && signAnswerFields("security")[0].key === "confirm" && signAnswerFields("security")[0].type === "check");
ok("보안 수칙: 주황 옵션(수칙·회사), 노랑(이름·부서·작성일)", FIELDS.security.filter((x) => x.grp === "o").map((x) => x.key).join() === "company,rules" && FIELDS.security.filter((x) => x.grp === "y").map((x) => x.key).join() === "name,dept,signDate" && DOC_TYPES.security.coll === "contracts" && !DOC_TYPES.security.needs);
ok("보안 수칙: 수칙 문구는 이스케이프", !buildDocHtml("security", { ...SE, rules: "<img src=x onerror=1>" }, { autoPrint: false }).includes("<img src=x"));
ok("이전 양식 서약서는 legacy 표시(새로 만들기 대상 아님)이고 서약서는 보안 수칙 문서", DOC_TYPES.pledge.legacy === true && DOC_TYPES.pledge.title.includes("이전 양식") && !DOC_TYPES.security.legacy);
ok("이전 양식 서약서 문서도 여전히 열린다", buildDocHtml("pledge", defaultsFor("pledge", { emp, today: "2026-11-17" }), { autoPrint: false }).includes("서 약 서"));
// 원본 해시 · 전화번호 도우미
ok("SHA-256 표준 값", (await sha256Hex("abc")) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
ok("canonicalJson: 키 순서와 상관없이 같은 문자열", canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }) === canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
const hc = { type: "labor", title: "근로계약서 · 홍", data: { name: "홍", monthlyPay: 2400000 } };
const h1 = await docHashOf(hc);
ok("문서 해시: 64자 16진수, 같은 내용이면 같고 한 글자만 달라도 다름", /^[0-9a-f]{64}$/.test(h1) && h1 === (await docHashOf({ ...hc, data: { monthlyPay: 2400000, name: "홍" } })) && h1 !== (await docHashOf({ ...hc, data: { name: "홍", monthlyPay: 2400001 } })) && h1 !== (await docHashOf({ ...hc, title: "근로계약서 · 홍 " })));
ok("문서 해시에는 문서 버전이 들어감", h1 !== (await docHashOf(hc, "2099.01")) && CONTRACT_VERSION.length > 0);
ok("서명 해시: 직원이 고른 답이 바뀌면 달라짐", (await signedHashOf({ ...hc, docHash: h1 }, { mealChoice: "meal" })) !== (await signedHashOf({ ...hc, docHash: h1 }, { mealChoice: "lunch" })));
ok("전화번호: 국제 형식·가리기", toE164("010-1234-5678") === "+821012345678" && toE164("+82 10 1234 5678") === "+821012345678" && toE164("821012345678") === "+821012345678" && toE164("") === "" && maskPhone("+821012345678") === "010-****-5678" && maskPhone("") === "");
const sigh = buildDocHtml("consent", defaultsFor("consent", { emp, today: "2026-11-17" }), { autoPrint: false, sign: { img: "data:image/png;base64,AA", at: 0, name: "김효진", hash: h1, version: "2026.11", phone: "+821012345678" } });
ok("서명본 하단: 해시 일부·문서 버전·문자 인증 번호(가림)", sigh.includes(h1.slice(0, 16)) && sigh.includes("문서 버전 2026.11") && sigh.includes("문자 인증 010-****-5678") && !sigh.includes("1012345678"));
console.log(f ? `\n${f} FAILURES` : "\nALL PASS"); process.exit(f ? 1 : 0);
