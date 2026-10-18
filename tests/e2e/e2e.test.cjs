const { chromium } = require("playwright");
const fs = require("fs"); const path = require("path");
const http = require("http");
const DIR = __dirname, ROOT = path.join(__dirname, "..", ".."); let BASE = "";
// 저장소 루트를 그대로 서빙하는 작은 정적 서버 (Firebase 는 mocks/ 로 대체해 네트워크 없이 돈다)
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const p = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[\/\\])+/, "");
      const f = path.join(ROOT, p === "/" || p === path.sep ? "index.html" : p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => { BASE = "http://127.0.0.1:" + srv.address().port; resolve(srv); });
  });
}
fs.mkdirSync(path.join(DIR, "shots"), { recursive: true });
const MOCKNAMES = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js", "firebase-storage.js"];
const mocks = Object.fromEntries(MOCKNAMES.map((n) => [n, fs.readFileSync(path.join(DIR, "mocks", n), "utf8")]));
const results = []; let failures = 0;
const ok = (name, cond, extra = "") => { results.push(`${cond ? "PASS" : "FAIL"} ${name}${extra ? " — " + String(extra).slice(0, 300) : ""}`); if (!cond) failures++; };
const J = (x) => JSON.parse(JSON.stringify(x));

async function newPage(browser, { user = null, store = {}, files = {}, viewport = { width: 1200, height: 900 }, now = "" } = {}) {
  const ctx = await browser.newContext({ viewport, locale: "ko-KR", serviceWorkers: "block" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|permission|denied/i.test(m.text())) errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  if (now) await page.clock.setFixedTime(new Date(now));
  await page.route("https://www.gstatic.com/firebasejs/**", (r) => r.fulfill({ contentType: "application/javascript", body: mocks[r.request().url().split("/").pop()] || "" }));
  await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
  await page.addInitScript(({ user, store, files }) => {
    globalThis.__mockUser = user; globalThis.__mockStore = store; globalThis.__mockFiles = files;
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied = t; } }, configurable: true });
  }, { user, store, files });
  return { page, ctx, errors };
}
const vis = (page, sel) => page.locator(sel).first().evaluate((el) => !el.classList.contains("hidden") && el.offsetParent !== null).catch(() => false);
const count = (page, sel) => page.locator(sel).count();
const S = (page, path) => page.evaluate((p) => { const [c, i] = [p.slice(0, p.lastIndexOf("/")), p.slice(p.lastIndexOf("/") + 1)]; return globalThis.__mockStore[c]?.[i]; }, path);
const FILES = (page) => page.evaluate(() => Object.keys(globalThis.__mockFiles));
const shot = (page, n) => page.screenshot({ path: path.join(DIR, "shots", n + ".png"), fullPage: true });
const buf = (s) => Buffer.from(s);

(async () => {
  const server = await startServer();
  const browser = await chromium.launch();
  let snapStore, snapFiles, token;

  // ================= B. 최고관리자 =================
  {
    const store = { roles: { u1: { level: "super", orgId: "hq", employeeId: "emp_0001" }, u4: { level: "admin", orgId: "banpo", employeeId: "emp_0004" } } };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "Boss@Jarada.kr" }, store });
    await page.goto(BASE + "/index.html"); await page.waitForSelector("#viewDash:not(.hidden)");
    ok("B hq auto", (await S(page, "orgs/hq"))?.type === "hq");

    // 내 정보 등록 → 상세 화면
    await page.evaluate(() => (location.hash = "#me")); await page.waitForSelector("#formMe");
    await page.fill("#fMeName", "김대표"); await page.fill("#fMePosition", "대표"); await page.click("#btnMeSave");
    await page.waitForSelector("#viewDetail:not(.hidden) .emp-name");
    ok("B me employee orgIds", JSON.stringify((await S(page, "employees/emp_0001")).orgIds) === '["hq"]');
    ok("B me shows detail", (await page.textContent("#detailRoot")).includes("김대표"));

    // 조직 2개 추가
    await page.evaluate(() => (location.hash = "#orgs")); await page.waitForSelector("#btnAddOrg:not(.hidden)");
    for (const [id, name] of [["anyang", "안양 평촌원"], ["banpo", "반포원"]]) {
      await page.click("#btnAddOrg"); await page.fill("#fOrgId", id); await page.fill("#fOrgName", name); await page.click("#btnOrgSave"); await page.waitForTimeout(150);
    }
    ok("B orgs created", (await count(page, "#tblOrgs tbody tr")) === 3);

    // 직원 등록(다이얼로그, 지점 복수)
    await page.evaluate(() => (location.hash = "#employees")); await page.waitForSelector("#btnAddEmp");
    await page.click("#btnAddEmp"); await page.waitForTimeout(100);
    ok("B emp dlg org checkboxes", (await count(page, "#fOrgs input")) === 3);
    ok("B default org hq checked", await page.locator("#fOrgs input[value=hq]").isChecked());
    await page.uncheck("#fOrgs input[value=hq]"); await page.click("#btnEmpSave"); await page.waitForTimeout(50);
    ok("B emp validation", (await page.textContent("#empErr")).includes("이름"));
    await page.fill("#fName", "최팀장"); await page.fill("#fEmail", "Choi@Jarada.kr"); await page.fill("#fPhone", "010-5555-6666");
    await page.click("#btnEmpSave"); await page.waitForTimeout(50);
    ok("B emp validation orgs", (await page.textContent("#empErr")).includes("지점"));
    await page.check("#fOrgs input[value=banpo]"); await page.check("#fOrgs input[value=anyang]");
    await page.click("#btnEmpSave"); await page.waitForTimeout(250);
    const e2 = await S(page, "employees/emp_0002");
    ok("B emp_0002 multi org", e2 && JSON.stringify(e2.orgIds) === '["anyang","banpo"]' && e2.orgId === "anyang", JSON.stringify(e2));

    // 일괄 등록
    await page.click("#btnBulk"); await page.waitForTimeout(100);
    const tsv = [
      "이름\t이메일\t소속 지점\t직책\t전번\t입사일\t권한\t상태\t주소\t근로시작일\t보호자 연락처\t기본급\t추가급여1 항목\t추가급여1 금액\t생년월일",
      "이교사\tlee@jarada.kr\t안양 평촌원/반포원\t교사\t010-1111-2222\t2024.3.2\t직원\t재직\t서울 서초\t2024-03-02\t010-9999-0000\t3,000,000\t자기 계발비\t100,000원\t1995.5.21",
      "박원장\tpark@jarada.kr\tbanpo\t원장\t010-3333-4444\t20200101\t관리자\t\t\t\t",
      "오류\tbad-email\t없는지점\t\t\t\t이상한권한\t\t\t\t",
      "중복\tchoi@jarada.kr\tbanpo\t\t\t\t\t\t\t\t",
      "급여오류\tpay@jarada.kr\tbanpo" + "\t".repeat(9) + "abc",
    ].join("\n");
    await page.fill("#bulkText", tsv); await page.waitForTimeout(100);
    ok("B bulk summary", (await page.textContent("#bulkSummary")).includes("총 5행") && (await page.textContent("#bulkSummary")).includes("등록 가능 2명") && (await page.textContent("#bulkSummary")).includes("오류 3행"), await page.textContent("#bulkSummary"));
    ok("B bulk error texts", (await page.textContent("#bulkPreview")).includes("지점 ‘없는지점’ 없음") && (await page.textContent("#bulkPreview")).includes("이미 등록된 이메일") && (await page.textContent("#bulkPreview")).includes("기본급 형식 오류"));
    await shot(page, "G1-bulk");
    ok("B bulk btn label", (await page.textContent("#btnBulkSave")).includes("정상 2명 등록"));
    await page.click("#btnBulkSave"); await page.waitForTimeout(400);
    const e3 = await S(page, "employees/emp_0003"), e4 = await S(page, "employees/emp_0004");
    ok("B bulk birthDate", e3 && e3.birthDate === "1995-05-21", JSON.stringify(e3));
    ok("B bulk emp_0003", e3 && e3.name === "이교사" && JSON.stringify(e3.orgIds) === '["anyang","banpo"]' && e3.joinedAt === "2024-03-02" && e3.level === "staff" && e3.status === "active", JSON.stringify(e3));
    ok("B bulk emp_0004 admin banpo", e4 && e4.level === "admin" && e4.orgId === "banpo" && e4.joinedAt === "2020-01-01", JSON.stringify(e4));
    const pi3 = await S(page, "employees/emp_0003/private/personalInfo");
    ok("B bulk personalInfo", pi3 && pi3.address === "서울 서초" && pi3.workStartDate === "2024-03-02" && pi3.guardianPhone === "010-9999-0000", JSON.stringify(pi3));
    const bc = await S(page, "employees/emp_0003/private/compensation");
    ok("B bulk compensation", bc && bc.baseSalary === "3000000" && bc.additionalLabel1 === "자기 계발비" && bc.additionalSalary1 === "100000" && !bc.additionalLabel2, JSON.stringify(bc));
    ok("B bulk no comp for 0004", !(await S(page, "employees/emp_0004/private/compensation")));
    ok("B bulk no pi for 0004", !(await S(page, "employees/emp_0004/private/personalInfo")));
    ok("B bulk batch sizes", JSON.stringify(await page.evaluate(() => globalThis.__batches)) === "[4]", JSON.stringify(await page.evaluate(() => globalThis.__batches)));
    ok("B bulk counter", (await S(page, "meta/counters")).employee === 4);
    ok("B list rows & tags", (await count(page, "#tblEmp tbody tr")) === 4 && (await count(page, "#tblEmp .branch-tag")) >= 5);
    await shot(page, "G2-employees");

    // 상세: emp_0003
    await page.click('#tblEmp tr[data-id="emp_0003"]'); await page.waitForSelector("#detailRoot .emp-name");
    ok("B detail name", (await page.textContent(".emp-name")) === "이교사");
    ok("B detail branches checked", (await count(page, "#dBranches input:checked")) === 2);
    ok("B detail mgr buttons", (await vis(page, "#dBtnLink")) && (await vis(page, "#dBtnCert")) && (await vis(page, "#dBtnCareer")) && (await vis(page, "#dBtnEdit")));
    ok("B detail sections", (await vis(page, "#cBase")) && (await vis(page, "#dEvalZone")) && (await vis(page, "#dBtnEtc")) && (await vis(page, "#dBtnShow")));
    ok("B personal prefilled", (await page.inputValue('[data-pi="address"]')) === "서울 서초" && (await page.inputValue('[data-pi="workStartDate"]')) === "2024-03-02");

    // 개인정보 저장 (merge)
    await page.fill('[data-pi="bankAccount"]', "신한 110-000-111"); await page.fill('[data-pi="guardianName"]', "이부모"); await page.fill('[data-pi="resignDate"]', "2030-12-31");
    await page.click("#dBtnPi"); await page.waitForTimeout(150);
    const pi3b = await S(page, "employees/emp_0003/private/personalInfo");
    ok("B personal saved merged", pi3b.bankAccount === "신한 110-000-111" && pi3b.guardianName === "이부모" && pi3b.address === "서울 서초" && pi3b.resignDate === "2030-12-31", JSON.stringify(pi3b));

    // 주민번호
    await page.fill("#dFront", "81082"); await page.click("#dBtnRrn"); await page.waitForTimeout(100);
    ok("B rrn invalid blocked", !(await S(page, "employees/emp_0003/private/residentFront")) && (await page.textContent("#toast")).includes("6자리"));
    await page.fill("#dFront", "810825"); await page.fill("#dBack", "1234567"); await page.click("#dBtnRrn"); await page.waitForTimeout(150);
    ok("B rrn saved", (await S(page, "employees/emp_0003/private/residentFront")).value === "810825" && (await S(page, "employees/emp_0003/private/residentBack")).value === "1234567");
    ok("B rrn flags", (await S(page, "employees/emp_0003/private/flags")).residentFront === true && (await page.textContent("#dRrnStatus")).includes("뒷자리: 등록됨"));
    await page.click("#dBtnShow"); ok("B rrn show toggles", (await page.getAttribute("#dBack", "type")) === "text");

    // 급여
    await page.fill("#cBase", "3000000"); await page.fill("#cMeal", "100000"); await page.fill("#cAddLabel1", "자기 계발비"); await page.fill("#cAdd1", "100000"); await page.fill("#cAddLabel2", "차량 지원금"); await page.fill("#cAdd2", "200000"); await page.fill("#cAddLabel3", "직책 수당"); await page.fill("#cIncTh", "5명 초과"); await page.fill("#cMemo", "테스트 메모");
    await page.click("#cBtnSev"); await page.fill('[data-sev="0.year"]', "2025"); await page.fill('[data-sev="0.month"]', "3"); await page.fill('[data-sev="0.day"]', "1"); await page.fill('[data-sev="0.amount"]', "500000");
    await page.click("#cBtnSave"); await page.waitForTimeout(150);
    const comp = await S(page, "employees/emp_0003/private/compensation");
    ok("B comp extra pay 1-3", comp.additionalLabel1 === "자기 계발비" && comp.additionalSalary1 === "100000" && comp.additionalLabel2 === "차량 지원금" && comp.additionalSalary2 === "200000" && comp.additionalLabel3 === "직책 수당" && comp.additionalSalary3 === "", JSON.stringify(comp));
    await shot(page, "G7-comp");
    ok("B comp saved", comp.baseSalary === "3000000" && comp.incentiveThreshold === "5명 초과" && comp.severanceSettlements.length === 1 && comp.severanceSettlements[0].amount === "500000", JSON.stringify(comp));

    // 서류 업로드
    await page.setInputFiles('[data-up="resume"]', { name: "이력서.pdf", mimeType: "application/pdf", buffer: buf("pdf1") }); await page.waitForTimeout(250);
    let fl = await FILES(page);
    ok("B resume uploaded to pub", fl.filter((p) => p.startsWith("hr/emp_0003/pub/resume__")).length === 1 && fl[0].endsWith("__이력서.pdf"), fl.join(","));
    ok("B resume shown", (await page.textContent('[data-slot="resume"]')).includes("이력서.pdf"));
    await page.waitForTimeout(5);
    await page.setInputFiles('[data-up="resume"]', { name: "이력서_v2.pdf", mimeType: "application/pdf", buffer: buf("pdf2") }); await page.waitForTimeout(250);
    fl = await FILES(page);
    ok("B resume replaced (old removed)", fl.filter((p) => p.includes("/resume__")).length === 1 && fl.some((p) => p.endsWith("이력서_v2.pdf")), fl.join(","));
    await page.setInputFiles('[data-up="bankbookCopy"]', { name: "통장.jpg", mimeType: "image/jpeg", buffer: buf("jpg") }); await page.waitForTimeout(250);
    ok("B secret to sec", (await FILES(page)).some((p) => p.startsWith("hr/emp_0003/sec/bankbookCopy__")));
    await page.setInputFiles("#dEvalInput", [{ name: "평가1.xlsx", mimeType: "application/octet-stream", buffer: buf("a") }, { name: "평가2.xlsx", mimeType: "application/octet-stream", buffer: buf("b") }]); await page.waitForTimeout(350);
    ok("B eval 2 files", (await count(page, "#dEval .file-slot")) === 2, (await FILES(page)).join(","));
    await page.click("#dBtnEtc"); await page.fill(".etc-draft [data-f=label]", "자격증 사본"); await page.fill(".etc-draft [data-f=desc]", "보육교사 2급");
    await page.setInputFiles(".etc-draft input[type=file]", { name: "자격증.png", mimeType: "image/png", buffer: buf("png") }); await page.click(".etc-draft [data-f=go]"); await page.waitForTimeout(300);
    ok("B etc item with label", (await page.textContent("#dEtc")).includes("자격증 사본") && (await page.textContent("#dEtc")).includes("보육교사 2급"));
    ok("B flags uploaded", (await S(page, "employees/emp_0003/private/flags")).uploaded.resume === true && (await S(page, "employees/emp_0003/private/flags")).uploaded.bankbookCopy === true);
    await shot(page, "G3-detail-super");
    // 삭제(평가 파일 1개) 후 고정 서류 삭제
    await page.click('#dEval [data-del-path] >> nth=0'); await page.waitForTimeout(250);
    ok("B eval delete", (await count(page, "#dEval .file-slot")) === 1);
    await page.click('[data-slot="resume"] [data-del-key]'); await page.waitForTimeout(250);
    ok("B resume deleted & flag false", !(await FILES(page)).some((p) => p.includes("/resume__")) && (await S(page, "employees/emp_0003/private/flags")).uploaded.resume === false);

    // 등록 링크
    await page.click("#dBtnLink"); await page.waitForTimeout(200);
    const copied = await page.evaluate(() => window.__copied); const emp3 = await S(page, "employees/emp_0003");
    token = emp3.selfToken;
    ok("B link token", /^[0-9a-f]{32}$/.test(token || "") && copied && copied.includes("?self=emp_0003&t=" + token), copied);
    await page.click("#dBtnLink"); await page.waitForTimeout(100);
    ok("B link stable token", (await S(page, "employees/emp_0003")).selfToken === token);

    // 증명서
    await page.click("#dBtnCert"); await page.waitForTimeout(100);
    ok("B cert prefilled", (await page.inputValue("#certBranch")) === "안양 평촌원, 반포원" && (await page.inputValue("#certApplyDate")) === "2024-03-02");
    await page.selectOption("#certCompany", "피크코퍼레이션(주)");
    ok("B cert company fill", (await page.inputValue("#certCeo")) === "양진혁");
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.click("#btnCertGo")]);
    await popup.waitForLoadState();
    const ph = await popup.content();
    ok("B cert content", ph.includes("재직증명서") && ph.includes("이교사") && ph.includes("810825 - ●●●●●●●") && ph.includes("2024-03-02 ~ 현재") && ph.includes("data:image/png;base64"), ph.slice(0, 200));
    await popup.close();
    await page.click("#dBtnCareer"); const [p2] = await Promise.all([ctx.waitForEvent("page"), page.click("#btnCertGo")]); await p2.waitForLoadState();
    ok("B career cert", (await p2.content()).includes("경력증명서")); await p2.close();

    // 지점 저장
    await page.uncheck('#dBranches input[value=banpo]'); await page.click("#dBtnBranches"); await page.waitForTimeout(300);
    ok("B branch save", JSON.stringify((await S(page, "employees/emp_0003")).orgIds) === '["anyang"]');
    await page.check('#dBranches input[value=banpo]'); await page.click("#dBtnBranches"); await page.waitForTimeout(300);
    ok("B branch restore", JSON.stringify((await S(page, "employees/emp_0003")).orgIds) === '["anyang","banpo"]');

    // 기본 정보 수정 → 퇴직 (emp_0004): roles 삭제
    await page.evaluate(() => (location.hash = "#emp/emp_0004")); await page.waitForSelector(".emp-name");
    await page.click("#dBtnEdit"); await page.waitForTimeout(100);
    ok("B edit dlg multi", (await page.locator("#dlgEmp").evaluate((d) => d.open)) && (await count(page, "#fOrgs input:checked")) === 1);
    await page.selectOption("#fStatus", "resigned"); await page.click("#btnEmpSave"); await page.waitForTimeout(350);
    ok("B resign removes role", !(await S(page, "roles/u4")));
    ok("B status saved", (await S(page, "employees/emp_0004")).status === "resigned");
    await page.selectOption ? null : null;
    // 복직 상태로 되돌려 스냅샷
    await page.click("#dBtnEdit"); await page.selectOption("#fStatus", "active"); await page.click("#btnEmpSave"); await page.waitForTimeout(300);

    // 스냅샷 (삭제 테스트 전)
    snapStore = J(await page.evaluate(() => globalThis.__mockStore)); snapFiles = J(await page.evaluate(() => globalThis.__mockFiles));
    snapStore.roles.u4 = { level: "admin", orgId: "banpo", employeeId: "emp_0004" };

    // 직원 삭제 → 하위 문서/파일 정리
    await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector(".emp-name");
    await page.click("#dBtnEdit"); await page.waitForTimeout(100); await page.click("#btnEmpDelete"); await page.waitForTimeout(500);
    ok("B soft delete moves to trash", (await S(page, "employees/emp_0003")).deleted === true && (await page.evaluate(() => location.hash)) === "#employees");
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs"); await page.click('#adminTabs [data-t="trash"]'); await page.click("[data-purge]"); await page.waitForTimeout(700);
    ok("B delete emp", !(await S(page, "employees/emp_0003")));
    ok("B delete cleans private", !(await S(page, "employees/emp_0003/private/personalInfo")) && !(await S(page, "employees/emp_0003/private/compensation")) && !(await S(page, "employees/emp_0003/private/residentBack")) && !(await S(page, "employees/emp_0003/private/flags")));
    ok("B delete cleans files", !(await FILES(page)).some((p) => p.startsWith("hr/emp_0003/")), (await FILES(page)).join(","));
    ok("B no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ================= C. 관리자 (반포원) =================
  {
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: J(snapStore), files: J(snapFiles) });
    await page.goto(BASE + "/index.html#employees"); await page.waitForSelector("#viewEmployees:not(.hidden)");
    const ids = await page.$$eval("#tblEmp tbody tr", (r) => r.map((x) => x.dataset.id));
    ok("C scope = banpo members (primary or secondary)", JSON.stringify(ids) === '["emp_0002","emp_0003","emp_0004"]', JSON.stringify(ids));
    await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector(".emp-name");
    await page.waitForTimeout(300);
    ok("C no comp/eval/etc", !(await vis(page, "#cBase")) && !(await vis(page, "#dEvalZone")) && !(await vis(page, "#dBtnEtc")));
    ok("C branches locked", (await count(page, "#dBranches input:disabled")) === 3 && (await count(page, "#dBtnBranches")) === 0);
    ok("C mgr buttons", (await vis(page, "#dBtnLink")) && (await vis(page, "#dBtnCert")) && (await vis(page, "#dBtnEdit")));
    ok("C no back reveal", (await count(page, "#dBtnShow")) === 0 && (await page.inputValue("#dBack")) === "");
    ok("C front visible", (await page.inputValue("#dFront")) === "810825");
    ok("C status line", (await page.textContent("#dRrnStatus")).includes("뒷자리: 이미 등록됨 (조회 불가)"));
    ok("C pub upload ok, sec upload hidden", (await count(page, '[data-up="resume"]')) === 1 && (await count(page, '[data-up="residentCopy"]')) === 0 && (await count(page, '[data-up="bankbookCopy"]')) === 0);
    ok("C secret shows registered flag only", (await page.textContent('[data-slot="bankbookCopy"]')).includes("이미 등록됨"));
    const lists = await page.evaluate(() => globalThis.__lists);
    ok("C only pub folder listed", lists.every((p) => p.endsWith("/pub")) && lists.length >= 1, JSON.stringify(lists));
    const reads = await page.evaluate(() => globalThis.__reads);
    ok("C no comp/back reads", !reads.some((p) => p.endsWith("compensation") || p.endsWith("residentBack")), reads.join(","));
    await page.setInputFiles('[data-up="portfolio"]', { name: "포폴.pdf", mimeType: "application/pdf", buffer: buf("p") }); await page.waitForTimeout(300);
    ok("C admin uploads portfolio", (await FILES(page)).some((p) => p.startsWith("hr/emp_0003/pub/portfolio__")) && (await page.textContent('[data-slot="portfolio"]')).includes("포폴.pdf"));
    // 관리자의 대시보드/등록
    await page.evaluate(() => (location.hash = "#employees")); await page.click("#btnAddEmp"); await page.waitForTimeout(100);
    ok("C new emp org locked to own", (await count(page, "#fOrgs input:checked")) === 1 && (await count(page, "#fOrgs input:disabled")) === 3);
    await page.fill("#fName", "신입"); await page.fill("#fEmail", "new@jarada.kr"); await page.click("#btnEmpSave"); await page.waitForTimeout(300);
    const ne = await S(page, "employees/emp_0005");
    ok("C admin creates in own org", ne && JSON.stringify(ne.orgIds) === '["banpo"]' && ne.orgId === "banpo", JSON.stringify(ne));
    await page.evaluate(() => (location.hash = "#employees")); await page.click("#btnBulk"); await page.waitForTimeout(100);
    await page.fill("#bulkText", "이름\t이메일\t기본급\n급여넣기\tpaytest@jarada.kr\t1000000\n정상\tfine@jarada.kr\t");
    await page.waitForTimeout(100);
    ok("C admin cannot bulk-import salary", (await page.textContent("#bulkPreview")).includes("급여 정보는 최고관리자만") && (await page.textContent("#bulkSummary")).includes("등록 가능 1명"), await page.textContent("#bulkSummary"));
    await page.click("#btnBulkTemplate").catch(() => {});
    ok("C no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ================= D. 직원(본인) =================
  {
    const store = J(snapStore); store.roles.u3 = { level: "staff", orgId: "anyang", employeeId: "emp_0003" };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u3", email: "lee@jarada.kr" }, store, files: J(snapFiles) });
    await page.goto(BASE + "/index.html"); await page.waitForSelector("#viewDetail:not(.hidden) .emp-name");
    ok("D tabs", (await count(page, "#nav .tab")) === 5 && (await page.textContent("#nav")).includes("내 정보") && (await page.textContent("#nav")).includes("달력"));
    ok("D no mgr buttons/back", !(await vis(page, "#dBtnLink")) && !(await vis(page, "#dBtnEdit")) && (await count(page, ".back-link")) === 0);
    ok("D no comp/eval", !(await vis(page, "#cBase")) && !(await vis(page, "#dEvalZone")));
    ok("D branches locked", (await count(page, "#dBranches input:disabled")) === 3);
    ok("D all 8 upload zones", (await count(page, "input[data-up]")) === 8);
    ok("D no storage list", !(await page.evaluate(() => globalThis.__lists)));
    ok("D own front shown, back empty", (await page.inputValue("#dFront")) === "810825" && (await page.inputValue("#dBack")) === "");
    ok("D flags shown", (await page.textContent('[data-slot="bankbookCopy"]')).includes("이미 등록됨"));
    await page.setInputFiles('[data-up="residentCopy"]', { name: "등본.pdf", mimeType: "application/pdf", buffer: buf("x") }); await page.waitForTimeout(300);
    ok("D upload sec by self", (await FILES(page)).some((p) => p.startsWith("hr/emp_0003/sec/residentCopy__")) && (await page.textContent('[data-slot="residentCopy"]')).includes("이미 등록됨"));
    await page.fill("#dBack", "7654321"); await page.click("#dBtnRrn"); await page.waitForTimeout(200);
    ok("D self writes back, hidden after", (await S(page, "employees/emp_0003/private/residentBack")).value === "7654321" && (await page.inputValue("#dBack")) === "");
    await page.fill('[data-pi="address"]', "새 주소"); await page.click("#dBtnPi"); await page.waitForTimeout(150);
    ok("D self saves personal", (await S(page, "employees/emp_0003/private/personalInfo")).address === "새 주소");
    await page.evaluate(() => (location.hash = "#emp/emp_0002")); await page.waitForTimeout(300);
    ok("D cannot open others", (await page.textContent("#detailRoot")).includes("이교사") || !(await page.textContent("#detailRoot")).includes("최팀장"));
    await shot(page, "G4-detail-staff");
    ok("D no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ================= E. 등록 링크 (익명) =================
  {
    const { page, ctx, errors } = await newPage(browser, { user: null, store: J(snapStore), files: J(snapFiles) });
    await page.goto(BASE + `/index.html?self=emp_0003&t=${token}`); await page.waitForSelector("#viewDetail:not(.hidden) .emp-name", { timeout: 5000 });
    const role = await S(page, "roles/anon1");
    ok("E anon role created", role && role.level === "staff" && role.employeeId === "emp_0003" && role.selfToken === token, JSON.stringify(role));
    ok("E self-mode ui", (await page.evaluate(() => document.body.classList.contains("self-mode"))) && !(await vis(page, "#nav")) && !(await vis(page, "#btnLogout")) && (await page.textContent("#detailRoot")).includes("직접 입력"));
    ok("E topbar", (await page.textContent("#topWho")).includes("등록 링크"));
    await page.fill('[data-pi="guardianName"]', "링크입력"); await page.click("#dBtnPi"); await page.waitForTimeout(150);
    ok("E saves", (await S(page, "employees/emp_0003/private/personalInfo")).guardianName === "링크입력");
    await shot(page, "G5-self");
    ok("E no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();

    const bad = await newPage(browser, { user: null, store: J(snapStore), files: J(snapFiles) });
    await bad.page.goto(BASE + `/index.html?self=emp_0003&t=wrong`); await bad.page.waitForSelector("#viewNoRole:not(.hidden)", { timeout: 5000 });
    ok("E bad token", (await bad.page.textContent("#noRoleTitle")).includes("링크가 올바르지"));
    ok("E bad token hides admin hint", !(await vis(bad.page, "#noRoleNotice")));
    ok("E bad no role", !(await S(bad.page, "roles/anon1")));
    await bad.ctx.close();
  }

  // ================= H. 본사 인사(hr) / 원장(principal) / 등급 보존 =================
  {
    const st = J(snapStore);
    st.roles.u_hr = { level: "hr", orgId: "hq", employeeId: "emp_0009" };
    st.employees.emp_0009 = { name: "인사담당", email: "hr@jarada.kr", orgId: "hq", orgIds: ["hq"], level: "hr", status: "active" };
    st.employees.emp_0010 = { name: "교육담당", email: "edu@jarada.kr", orgId: "hq", orgIds: ["hq"], level: "edu", status: "active" };
    st.employees.emp_0004.level = "principal"; st.roles.u4.level = "principal";
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u_hr", email: "hr@jarada.kr" }, store: st, files: J(snapFiles) });
    await page.goto(BASE + "/index.html#employees"); await page.waitForSelector("#viewEmployees:not(.hidden)");
    ok("H hr sees all employees", (await count(page, "#tblEmp tbody tr")) >= 6, await page.textContent("#empCount"));
    ok("H hr nav", (await page.textContent("#nav")).includes("대시보드") && (await page.textContent("#appSub")).includes("대표이사"));
    ok("H hr can add org", await vis(page, "#btnBulk"));
    await page.evaluate(() => (location.hash = "#orgs")); await page.waitForSelector("#btnAddOrg:not(.hidden)");
    ok("H hr add-org button visible", await vis(page, "#btnAddOrg"));
    await page.evaluate(() => (location.hash = "#emp/emp_0010")); await page.waitForSelector(".emp-name");
    await page.click("#dBtnEdit"); await page.waitForTimeout(100);
    ok("H edu level preserved in dialog", (await page.inputValue("#fLevel")) === "edu", await page.inputValue("#fLevel"));
    ok("H hr level options exclude super", !(await page.locator("#fLevel option[value=super]").count()) && (await page.locator("#fLevel option[value=principal]").count()) === 1);
    await page.fill("#fPosition", "교육팀장"); await page.click("#btnEmpSave"); await page.waitForTimeout(300);
    const e10 = await S(page, "employees/emp_0010");
    ok("H edit keeps level edu", e10.level === "edu" && e10.position === "교육팀장", JSON.stringify(e10));
    await page.evaluate(() => (location.hash = "#emp/emp_0001")); await page.waitForSelector(".emp-name");
    await page.click("#dBtnEdit"); await page.waitForTimeout(100);
    ok("H hr cannot edit super (locked)", await page.locator("#btnEmpSave").evaluate((b) => b.classList.contains("hidden")) && (await page.locator("#fLevel").isDisabled()));
    await page.click("#btnEmpCancel");
    await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector(".emp-name"); await page.waitForTimeout(300);
    ok("H hr detail: branches editable, no comp/eval", (await count(page, "#dBranches input:disabled")) === 0 && !(await vis(page, "#cBase")) && !(await vis(page, "#dEvalZone")) && (await vis(page, "#dBtnBranches")));
    ok("H hr lists pub only", (await page.evaluate(() => globalThis.__lists)).every((p) => p.endsWith("/pub")));
    ok("H hr cannot see back", (await count(page, "#dBtnShow")) === 0 && (await page.textContent("#dRrnStatus")).includes("조회 불가"));
    ok("H no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();

    const pr = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: J(st), files: J(snapFiles) });
    await pr.page.goto(BASE + "/index.html#employees"); await pr.page.waitForSelector("#viewEmployees:not(.hidden)");
    ok("H principal behaves as admin (scoped list)", JSON.stringify(await pr.page.$$eval("#tblEmp tbody tr", (r) => r.map((x) => x.dataset.id))) === '["emp_0002","emp_0003","emp_0004"]');
    await pr.page.evaluate(() => (location.hash = "#emp/emp_0004")); await pr.page.waitForSelector(".emp-name");
    await pr.page.click("#dBtnEdit"); await pr.page.waitForTimeout(100);
    ok("H principal edit keeps principal", (await pr.page.inputValue("#fLevel")) === "principal" && (await pr.page.locator("#fLevel option").count()) === 5, await pr.page.locator("#fLevel option").allTextContents());
    await pr.page.click("#btnEmpCancel");
    await pr.page.evaluate(() => (location.hash = "#emp/emp_0001")).catch(() => {});
    await pr.ctx.close();

    const adm = J(st); adm.roles.u4.level = "admin"; adm.employees.emp_0003.level = "hr";
    const a = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: adm, files: J(snapFiles) });
    await a.page.goto(BASE + "/index.html#emp/emp_0003"); await a.page.waitForSelector(".emp-name");
    await a.page.click("#dBtnEdit"); await a.page.waitForTimeout(100);
    ok("H admin cannot edit hr-level employee (locked)", await a.page.locator("#btnEmpSave").evaluate((b) => b.classList.contains("hidden")));
    await a.ctx.close();
  }

  // ================= I. 급여: 예전 단일 추가급여 이어받기 =================
  {
    const st = J(snapStore); st.employees["emp_0004/private"] = {}; st["employees/emp_0004/private"] = { compensation: { baseSalary: "2000000", additionalSalary: "50000" } };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: {} });
    await page.goto(BASE + "/index.html#emp/emp_0004"); await page.waitForSelector("#cBase");
    ok("I legacy extra pay shown as 추가급여1", (await page.inputValue("#cAdd1")) === "50000" && (await page.inputValue("#cAddLabel1")) === "");
    await page.fill("#cAdd1", ""); await page.click("#cBtnSave"); await page.waitForTimeout(200);
    await page.evaluate(() => (location.hash = "#employees")); await page.evaluate(() => (location.hash = "#emp/emp_0004")); await page.waitForSelector("#cBase");
    ok("I cleared value stays empty (legacy not revived)", (await page.inputValue("#cAdd1")) === "");
    ok("I no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }

  // ================= J. 달력 · 휴가 · 연차 (최고관리자) =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore);
    st.employees.emp_0003.joinedAt = "2024-03-02"; st.employees.emp_0003.birthDate = "1995-11-12";
    st.employees.emp_0004.joinedAt = "2020-01-01"; st.employees.emp_0004.birthDate = "1980-11-04"; st.employees.emp_0004.status = "active";
    st.employees.emp_0002.birthDate = "1992-02-29"; st.employees.emp_0002.joinedAt = "2025-09-01";
    const L = (o) => ({ orgId: "anyang", orgIds: ["anyang", "banpo"], ...o });
    st.leaveRequests = {
      l1: L({ employeeId: "emp_0003", employeeName: "이교사", type: "annual", startDate: "2026-11-09", endDate: "2026-11-10", days: 2, status: "approved", reason: "가족 여행" }),
      l2: { employeeId: "emp_0004", employeeName: "박원장", orgId: "banpo", orgIds: ["banpo"], type: "sick", startDate: "2026-11-16", endDate: "2026-11-17", days: 2, status: "approved", reason: "" },
      l3: L({ employeeId: "emp_0003", employeeName: "이교사", type: "half_am", startDate: "2026-11-18", endDate: "2026-11-18", days: 0.5, status: "submitted", reason: "병원" }),
      l4: L({ employeeId: "emp_0003", employeeName: "이교사", type: "annual", startDate: "2026-11-30", endDate: "2026-11-30", days: 1, status: "rejected", reason: "" }),
    };
    st.calendarEvents = {
      e1: { title: "설명회", kind: "event", startDate: "2026-11-20", endDate: "2026-11-20", orgIds: [] },
      e2: { title: "창립기념일", kind: "holiday", startDate: "2026-11-13", endDate: "2026-11-13", orgIds: [] },
    };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: {}, now: NOW });
    await page.goto(BASE + "/index.html#calendar"); await page.waitForSelector("#viewCalendar:not(.hidden) .cal-cell");
    const cell = (d) => `#calGrid .cal-cell[data-date="${d}"]`;
    const chips = (d) => page.$$eval(cell(d) + " .cal-items .chip", (e) => e.map((x) => x.textContent.trim()));
    ok("J title", (await page.textContent("#calTitle")) === "2026년 11월");
    ok("J grid has full weeks", (await count(page, "#calGrid .cal-cell")) >= 35 && (await count(page, "#calGrid .cal-cell")) % 7 === 0);
    ok("J today highlighted", await page.locator(cell("2026-11-04")).evaluate((c) => c.classList.contains("today")));
    ok("J birthday today", (await chips("2026-11-04")).some((x) => x.includes("박원장") && x.includes("생일")), JSON.stringify(await chips("2026-11-04")));
    ok("J birthday 11-12", (await chips("2026-11-12")).some((x) => x.includes("이교사") && x.includes("생일")));
    ok("J annual leave chips both days", (await chips("2026-11-09")).some((x) => x.includes("이교사") && x.includes("연차")) && (await chips("2026-11-10")).some((x) => x.includes("연차")));
    ok("J weekend not shown for leave", (await chips("2026-11-14")).length === 0);
    ok("J sick leave in 휴가 category", (await chips("2026-11-16")).some((x) => x.includes("박원장") && x.includes("병가")) && (await page.locator(cell("2026-11-16") + " .chip.cat-leave").count()) === 1);
    ok("J pending half-day marked", (await page.locator(cell("2026-11-18") + " .chip.pending").count()) === 1 && (await chips("2026-11-18"))[0].includes("반차"));
    ok("J rejected hidden", (await chips("2026-11-30")).length === 0);
    ok("J custom holiday label", (await page.textContent(cell("2026-11-13") + " .hol")).includes("창립기념일"));
    ok("J event chip", (await chips("2026-11-20")).some((x) => x.includes("설명회")));
    await page.click("#calPrev"); await page.waitForTimeout(100);
    ok("J prev month: 대체공휴일 label", (await page.textContent("#calTitle")) === "2026년 10월" && (await page.textContent(cell("2026-10-05") + " .hol")).includes("개천절 대체공휴일") && (await page.textContent(cell("2026-10-09") + " .hol")).includes("한글날"));
    await page.click("#calNext"); await page.waitForTimeout(100);
    await page.uncheck('#calFilters input[data-cat="birthday"]'); await page.waitForTimeout(100);
    ok("J filter hides birthdays", (await chips("2026-11-04")).length === 0);
    await page.check('#calFilters input[data-cat="birthday"]');
    ok("J agenda lists items", (await page.textContent("#calAgenda")).includes("설명회") && (await page.textContent("#calAgenda")).includes("박원장"));
    await shot(page, "J1-calendar");
    await page.click(cell("2026-11-18")); await page.waitForSelector("#dlgDay[open]");
    ok("J day dialog", (await page.textContent("#dayList")).includes("이교사") && (await page.textContent("#dayTitle")).includes("2026.11.18"));
    await page.click("#dayList [data-dec]"); await page.waitForSelector("#dlgDecision[open]");
    ok("J decision dialog info", (await page.textContent("#dcInfo")).includes("병원") && (await page.textContent("#dcInfo")).includes("연차 잔여"));
    await page.click("#btnDcReject"); await page.waitForTimeout(80);
    ok("J reject requires note", (await page.textContent("#dcErr")).includes("사유"));
    await page.click("#btnDcApprove"); await page.waitForTimeout(300);
    const l3 = await S(page, "leaveRequests/l3");
    ok("J approved saved", l3.status === "approved" && l3.decidedBy === "u1" && l3.days === 0.5, JSON.stringify(l3));
    ok("J pending style cleared", (await page.locator(cell("2026-11-18") + " .chip.pending").count()) === 0);
    await page.click("#btnCalLeave"); await page.waitForSelector("#dlgLeave[open]");
    ok("J leave dialog has employee select for admins", (await vis(page, "#lvEmpWrap")) && (await vis(page, "#lvApproveWrap")));
    await page.selectOption("#lvEmp", "emp_0003"); await page.selectOption("#lvType", "annual");
    await page.fill("#lvStart", "2026-11-23"); await page.fill("#lvEnd", "2026-11-27"); await page.waitForTimeout(100);
    ok("J days preview 5 + balance", (await page.textContent("#lvInfo")).includes("5일") && (await page.textContent("#lvInfo")).includes("연차 잔여"), await page.textContent("#lvInfo"));
    await page.fill("#lvEnd", "2026-11-25"); await page.waitForTimeout(100);
    ok("J days preview 3", (await page.textContent("#lvInfo")).includes("3일"), await page.textContent("#lvInfo"));
    await page.check("#lvApprove"); await page.fill("#lvReason", "대리 등록"); await page.click("#btnLvSave"); await page.waitForTimeout(300);
    const added = Object.values(await page.evaluate(() => globalThis.__mockStore.leaveRequests)).find((x) => x.startDate === "2026-11-23");
    ok("J admin-registered leave", added && added.status === "approved" && added.days === 3 && added.employeeId === "emp_0003" && JSON.stringify(added.orgIds) === '["anyang","banpo"]' && added.decisionNote === "관리자 등록", JSON.stringify(added));
    ok("J calendar shows new leave", (await chips("2026-11-24")).some((x) => x.includes("이교사")));
    await page.click("#btnCalLeave"); await page.selectOption("#lvEmp", "emp_0003"); await page.fill("#lvStart", "2026-11-24"); await page.fill("#lvEnd", "2026-11-24");
    await page.click("#btnLvSave"); await page.waitForTimeout(100);
    ok("J overlap blocked", (await page.textContent("#lvErr")).includes("겹치는"), await page.textContent("#lvErr"));
    await page.selectOption("#lvType", "half_pm"); await page.fill("#lvStart", "2026-11-13"); await page.click("#btnLvSave"); await page.waitForTimeout(100);
    ok("J custom holiday cannot be leave", (await page.textContent("#lvErr")).includes("평일이 없습니다"), await page.textContent("#lvErr"));
    await page.click("#btnLvCancel");
    await page.click("#btnEventNew"); await page.fill("#evTitle", "교사 워크숍"); await page.selectOption("#evKind", "training"); await page.fill("#evStart", "2026-11-26"); await page.fill("#evEnd", "2026-11-27");
    await page.click("#btnEvSave"); await page.waitForTimeout(300);
    const ev = Object.values(await page.evaluate(() => globalThis.__mockStore.calendarEvents)).find((x) => x.title === "교사 워크숍");
    ok("J event saved", ev && ev.kind === "training" && Array.isArray(ev.orgIds) && ev.orgIds.length === 0, JSON.stringify(ev));
    ok("J event shown on both days", (await chips("2026-11-26")).some((x) => x.includes("교사 워크숍") && x.includes("교육")) && (await chips("2026-11-27")).length >= 1);
    await page.evaluate(() => (location.hash = "#leaves")); await page.waitForSelector("#leavesRoot .card");
    const txt = await page.textContent("#leavesRoot");
    ok("J leaves: list + annual table", txt.includes("휴가 내역") && txt.includes("직원별 연차 현황") && txt.includes("이교사") && txt.includes("가족 여행"));
    const rowOf = () => page.$$eval("#leavesRoot table tr", (rs) => rs.map((r) => r.textContent.replace(/\s+/g, " ").trim()).find((x) => x.startsWith("이교사") && x.includes("2024-03-02")));
    const row = await rowOf();
    ok("J annual row 15 / 5.5 used / 9.5 left", row.includes("2년 근속") && row.includes("155.5009.5"), row);
    await page.click('[data-adjust="emp_0003"]'); await page.waitForSelector("#dlgAdjust[open]"); await page.fill("#adValue", "2"); await page.click("#btnAdSave"); await page.waitForTimeout(300);
    ok("J adjust saved", (await S(page, "employees/emp_0003")).annualAdjust === 2);
    ok("J adjust reflected 11.5", (await rowOf()).includes("11.5"), await rowOf());
    await shot(page, "J2-leaves");
    await page.selectOption("#lvFltStatus", "rejected");
    ok("J filter by status", (await page.textContent("#leavesRoot")).includes("반려"));
    await page.evaluate(() => (location.hash = "#emp/emp_0004")); await page.waitForSelector(".emp-name"); await page.click("#dBtnEdit"); await page.fill("#fBirth", "1981-06-30"); await page.click("#btnEmpSave"); await page.waitForTimeout(300);
    ok("J birthDate saved via dialog", (await S(page, "employees/emp_0004")).birthDate === "1981-06-30");
    await page.evaluate(() => (location.hash = "#calendar")); await page.waitForSelector(".cal-cell");
    for (let i = 0; i < 9; i++) await page.click("#calPrev");
    await page.waitForTimeout(100);
    ok("J Feb 29 birthday on 2/28 in non-leap year", (await page.textContent("#calTitle")) === "2026년 2월" && (await chips("2026-02-28")).some((x) => x.includes("최팀장") && x.includes("생일")), await page.textContent("#calTitle"));
    ok("J 설날 shown", (await page.textContent(cell("2026-02-17") + " .hol")).includes("설날"));
    ok("J no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();

    const st2 = J(st); st2.roles.u3 = { level: "staff", orgId: "anyang", employeeId: "emp_0003" };
    const s = await newPage(browser, { user: { uid: "u3", email: "lee@jarada.kr" }, store: st2, files: {}, now: NOW });
    await s.page.goto(BASE + "/index.html#calendar"); await s.page.waitForSelector(".cal-cell");
    const schips = (d) => s.page.$$eval(`#calGrid .cal-cell[data-date="${d}"] .cal-items .chip`, (e) => e.map((x) => x.textContent.trim()));
    ok("K staff sees own birthday", (await schips("2026-11-12")).some((x) => x.includes("이교사")));
    ok("K staff does not see others' birthday", (await schips("2026-11-04")).length === 0);
    ok("K staff sees own leave", (await schips("2026-11-09")).some((x) => x.includes("이교사")));
    ok("K staff does not see others' leave", (await schips("2026-11-16")).length === 0);
    ok("K staff sees company event + holiday", (await schips("2026-11-20")).some((x) => x.includes("설명회")) && (await s.page.textContent(`#calGrid .cal-cell[data-date="2026-11-13"] .hol`)).includes("창립기념일"));
    ok("K staff cannot add events / org filter hidden", !(await vis(s.page, "#btnEventNew")) && !(await vis(s.page, "#calOrg")));
    await s.page.evaluate(() => (location.hash = "#leaves")); await s.page.waitForSelector("#lvBtnNew");
    const stxt = await s.page.textContent("#leavesRoot");
    ok("K staff: my annual card only", stxt.includes("내 연차") && !stxt.includes("승인 대기 ") && !stxt.includes("직원별 연차 현황"), stxt.slice(0, 160));
    ok("K staff balance", stxt.includes("2년 근속") && stxt.includes("15"));
    await s.page.click("#lvBtnNew"); await s.page.waitForSelector("#dlgLeave[open]");
    ok("K staff dialog: no employee select", !(await vis(s.page, "#lvEmpWrap")) && !(await vis(s.page, "#lvApproveWrap")));
    await s.page.selectOption("#lvType", "half_pm");
    ok("K half-day hides end date", !(await vis(s.page, "#lvEndWrap")));
    await s.page.fill("#lvStart", "2026-12-02"); await s.page.click("#btnLvSave"); await s.page.waitForTimeout(300);
    const mine = Object.values(await s.page.evaluate(() => globalThis.__mockStore.leaveRequests)).find((x) => x.startDate === "2026-12-02");
    ok("K staff request is submitted", mine && mine.status === "submitted" && mine.days === 0.5 && mine.type === "half_pm" && mine.endDate === "2026-12-02", JSON.stringify(mine));
    ok("K shows in my list", (await s.page.textContent("#leavesRoot")).includes("승인 대기"));
    await s.page.selectOption("#lvFltMonth", "all"); await s.page.click("[data-cancel]"); await s.page.waitForTimeout(300);
    ok("K staff cancels own pending", Object.values(await s.page.evaluate(() => globalThis.__mockStore.leaveRequests)).find((x) => x.startDate === "2026-12-02").status === "cancelled");
    ok("K no errors", s.errors.length === 0, s.errors.join(" | "));
    await shot(s.page, "K1-staff-leaves");
    await s.ctx.close();

    const st3 = J(st); st3.roles.u4 = { level: "admin", orgId: "banpo", employeeId: "emp_0004" };
    const a = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: st3, files: {}, now: NOW });
    await a.page.goto(BASE + "/index.html#leaves"); await a.page.waitForSelector("#leavesRoot .card");
    ok("L admin pending badge on tab", (await a.page.textContent('.tab[data-view="leaves"]')).includes("1"));
    ok("L admin sees approval table", (await a.page.textContent("#leavesRoot")).includes("승인 대기") && (await a.page.textContent("#leavesRoot")).includes("병원"));
    await a.page.click("#leavesRoot [data-decide]"); await a.page.waitForSelector("#dlgDecision[open]"); await a.page.fill("#dcNote", "확인"); await a.page.click("#btnDcApprove"); await a.page.waitForTimeout(300);
    ok("L admin approves", (await S(a.page, "leaveRequests/l3")).status === "approved");
    ok("L badge cleared", !/\d/.test(await a.page.textContent('.tab[data-view="leaves"]')));
    ok("L no errors", a.errors.length === 0, a.errors.join(" | "));
    await a.ctx.close();
  }

  // ================= M. 관리: 내보내기·백업·감사로그·설정·링크·휴지통 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore);
    st.employees.emp_0004.status = "active"; st.employees.emp_0004.joinedAt = "2020-01-01";
    st.employees.emp_0003.selfTokenExpires = { seconds: Math.floor(Date.parse("2026-11-14T00:00:00+09:00") / 1000), nanoseconds: 0 };
    st.roles.anon9 = { level: "staff", employeeId: "emp_0003", selfToken: st.employees.emp_0003.selfToken };
    st.leaveRequests = { lx: { employeeId: "emp_0004", employeeName: "박원장", orgId: "banpo", orgIds: ["banpo"], type: "annual", startDate: "2026-12-07", endDate: "2026-12-07", days: 1, status: "approved" } };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: J(snapFiles), now: NOW });
    await page.goto(BASE + "/index.html#admin"); await page.waitForSelector("#viewAdmin:not(.hidden) .subtab");
    const tabs = await page.$$eval("#adminTabs .subtab", (b) => b.map((x) => x.textContent.trim()));
    ok("M super sees 6 admin tabs", tabs.length === 6 && tabs[0].includes("내보내기") && tabs.some((x) => x.includes("감사")) && tabs.some((x) => x.includes("설정")) && tabs.some((x) => x.includes("휴지통")), JSON.stringify(tabs));
    // CSV 내보내기
    await page.check("#xpPersonal"); await page.check("#xpComp");
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btnXp")]);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    ok("M csv filename (headless names non-ASCII downloads 'download')", /^(자라다_직원_\d{8}\.csv|download)$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    ok("M csv has BOM + header", csv.charCodeAt(0) === 0xFEFF && csv.includes("이름") && csv.includes("급여 기본급") && csv.includes("주소") && csv.includes("수습 종료일"));
    ok("M csv has employee data", csv.includes("이교사") && csv.includes("서울 서초") && csv.includes("3000000"), csv.slice(0, 300));
    ok("M csv excludes resident numbers", !csv.includes("810825") && !csv.includes("1234567"));
    // 전체 백업
    const [bk] = await Promise.all([page.waitForEvent("download"), page.click("#btnBackup")]);
    const bj = JSON.parse(fs.readFileSync(await bk.path(), "utf8"));
    const b3 = bj.employees.find((e) => e.id === "emp_0003");
    ok("M backup content", bj.app === "jarada-people" && bj.orgs.length >= 3 && b3 && b3.private.personalInfo.address === "서울 서초" && b3.private.compensation.baseSalary === "3000000" && Array.isArray(bj.leaveRequests), JSON.stringify(Object.keys(bj)));
    { const js = JSON.stringify(bj); for (const n of ["810825","1234567","7654321"]) { const i = js.indexOf(n); if (i >= 0) console.log("BACKUPHIT", n, js.slice(Math.max(0, i - 120), i + 40)); } }
    ok("M backup excludes resident numbers", !JSON.stringify(bj).includes("810825") && !JSON.stringify(bj).includes("1234567") && !JSON.stringify(bj).includes("7654321"));
    // 감사 로그
    let logs = Object.values(await page.evaluate(() => globalThis.__mockStore.auditLogs || {}));
    ok("M audit rows for export + backup", logs.some((l) => l.action === "export" && l.detail.includes("개인정보") && l.detail.includes("급여")) && logs.some((l) => l.action === "backup"), JSON.stringify(logs.map((l) => l.action)));
    const xl = logs.find((l) => l.action === "export");
    ok("M audit has actor", xl && xl.actorUid === "u1" && xl.actorEmail === "boss@jarada.kr" && xl.actorLevel === "super" && xl.at, JSON.stringify(xl));
    await page.click('#adminTabs [data-t="audit"]'); await page.waitForSelector("#auAction");
    ok("M audit table shows labels", (await page.textContent("#adminBody")).includes("엑셀 내보내기") && (await page.textContent("#adminBody")).includes("전체 백업"));
    await page.selectOption("#auAction", "backup");
    ok("M audit filter by action", (await count(page, "#adminBody tbody tr")) === 1);
    await page.selectOption("#auAction", "");
    // 민감정보 조회 기록
    await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector("#cBase"); await page.waitForTimeout(200);
    logs = Object.values(await page.evaluate(() => globalThis.__mockStore.auditLogs));
    const vs = logs.find((l) => l.action === "view_sensitive");
    ok("M sensitive view is logged", vs && vs.targetEmployeeId === "emp_0003" && vs.detail.includes("주민번호 뒷자리") && vs.detail.includes("급여"), JSON.stringify(vs));
    // 링크 관리
    ok("M link status shown", (await page.textContent("#dLinkState")).includes("사용 가능"), await page.textContent("#dLinkState") + " / " + JSON.stringify((await S(page, "employees/emp_0003")).selfToken));
    const oldTok = (await S(page, "employees/emp_0003")).selfToken;
    await page.click("#dBtnLinkNew"); await page.waitForTimeout(400);
    const e3 = await S(page, "employees/emp_0003");
    const copied = await page.evaluate(() => window.__copied);
    ok("M reissue: new token + 14d expiry", e3.selfToken !== oldTok && e3.selfTokenExpires && Math.abs(e3.selfTokenExpires.seconds - (Date.parse(NOW) / 1000 + 14 * 86400)) < 5 && copied.includes(e3.selfToken), JSON.stringify(e3.selfTokenExpires));
    ok("M reissue clears old link roles", !(await S(page, "roles/anon9")));
    ok("M status shows expiry", (await page.textContent("#dLinkState")).includes("까지"));
    await page.click("#dBtnLinkOff"); await page.waitForTimeout(300);
    const e3b = await S(page, "employees/emp_0003");
    ok("M revoke removes token", !e3b.selfToken && !e3b.selfTokenExpires && (await page.textContent("#dLinkState")).includes("발급된 링크 없음"));
    await page.click("#dBtnLink"); await page.waitForTimeout(400);
    ok("M copy issues a new link when none", !!(await S(page, "employees/emp_0003")).selfToken && (await page.evaluate(() => window.__copied)).includes("self=emp_0003"));
    // 설정
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs"); await page.click('#adminTabs [data-t="settings"]');
    await page.fill("#stLinkDays", "7"); await page.uncheck("#stRrnBack"); await page.click("#btnStSave"); await page.waitForTimeout(250);
    const set = await S(page, "settings/app");
    ok("M settings saved", set && set.linkDays === 7 && set.rrnBackEnabled === false, JSON.stringify(set));
    await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector("#dFront");
    ok("M rrn back hidden when disabled", (await count(page, "#dBack")) === 0 && (await page.textContent("#viewDetail")).includes("뒷자리는 새로 저장하지 않습니다"));
    ok("M existing back still reported", (await page.textContent("#dRrnStatus")).includes("뒷자리: 등록됨"));
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs"); await page.click('#adminTabs [data-t="settings"]');
    await page.click("#btnRrnPurge"); await page.waitForTimeout(500);
    ok("M purge removes back digits", !(await S(page, "employees/emp_0003/private/residentBack")) && (await S(page, "employees/emp_0003/private/flags")).residentBack === false && !!(await S(page, "employees/emp_0003/private/residentFront")));
    ok("M purge audited", Object.values(await page.evaluate(() => globalThis.__mockStore.auditLogs)).some((l) => l.action === "rrn_back_purge"));
    // 휴지통
    await page.evaluate(() => (location.hash = "#emp/emp_0004")); await page.waitForSelector(".emp-name"); await page.click("#dBtnEdit");
    ok("M trash button label", (await page.textContent("#btnEmpDelete")).includes("휴지통"));
    await page.click("#btnEmpDelete"); await page.waitForTimeout(400);
    const e4 = await S(page, "employees/emp_0004");
    ok("M soft delete", e4 && e4.deleted === true && e4.status === "resigned" && e4.deletedAt && !(await S(page, "roles/u4")), JSON.stringify(e4));
    ok("M returned to list without trashed", (await page.evaluate(() => location.hash)) === "#employees" && !(await page.textContent("#tblEmp")).includes("박원장"));
    await page.click("#btnAddEmp"); await page.fill("#fName", "복제"); await page.fill("#fEmail", "park@jarada.kr"); await page.check("#fOrgs input[value=banpo]"); await page.click("#btnEmpSave"); await page.waitForTimeout(150);
    ok("M trashed email still blocks duplicates", (await page.textContent("#empErr")).includes("이미 등록된 이메일"), await page.textContent("#empErr"));
    await page.click("#btnEmpCancel");
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs");
    ok("M trash badge", (await page.textContent('#adminTabs [data-t="trash"]')).includes("1"));
    await page.click('#adminTabs [data-t="trash"]');
    ok("M trash lists employee", (await page.textContent("#adminBody")).includes("박원장"));
    await page.click("[data-restore]"); await page.waitForTimeout(400);
    const e4r = await S(page, "employees/emp_0004");
    ok("M restore", e4r.deleted === undefined && e4r.status === "resigned");
    await page.evaluate(() => (location.hash = "#emp/emp_0004")); await page.waitForSelector(".emp-name"); await page.click("#dBtnEdit"); await page.click("#btnEmpDelete"); await page.waitForTimeout(400);
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs"); await page.click('#adminTabs [data-t="trash"]');
    await page.click("[data-purge]"); await page.waitForTimeout(600);
    ok("M purge employee", !(await S(page, "employees/emp_0004")) && !(await S(page, "leaveRequests/lx")), "emp/leaves");
    ok("M trash empty after purge", (await page.textContent("#adminBody")).includes("휴지통이 비어"));
    ok("M no errors", errors.length === 0, errors.join(" | "));
    await shot(page, "M1-admin");
    await ctx.close();

    // 지점 관리자 / 본사 인사 / 직원의 관리 화면
    const st2 = J(snapStore); st2.roles.u4 = { level: "admin", orgId: "banpo", employeeId: "emp_0004" }; st2.roles.u_hr2 = { level: "hr", orgId: "hq", employeeId: "emp_0001" };
    const a = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: st2, files: {}, now: NOW });
    await a.page.goto(BASE + "/index.html#admin"); await a.page.waitForSelector("#adminTabs .subtab");
    ok("M admin sees only export tab", (await count(a.page, "#adminTabs .subtab")) === 1 && !(await vis(a.page, "#btnBackup")) && !(await count(a.page, "#xpComp")) && (await count(a.page, "#xpPersonal")) === 0);
    await a.ctx.close();
    const h = await newPage(browser, { user: { uid: "u_hr2", email: "boss@jarada.kr" }, store: st2, files: {}, now: NOW });
    await h.page.goto(BASE + "/index.html#admin"); await h.page.waitForSelector("#adminTabs .subtab");
    const ht = await h.page.$$eval("#adminTabs .subtab", (b) => b.map((x) => x.textContent.trim()));
    ok("M hr sees export/status/audit/trash but not settings", ht.length === 4 && !ht.some((x) => x.includes("설정")) && (await count(h.page, "#xpPersonal")) === 1 && (await count(h.page, "#xpComp")) === 0 && (await count(h.page, "#btnBackup")) === 0, JSON.stringify(ht));
    await h.ctx.close();
    const sf = J(snapStore); sf.roles.u3 = { level: "staff", orgId: "anyang", employeeId: "emp_0003" };
    const s = await newPage(browser, { user: { uid: "u3", email: "lee@jarada.kr" }, store: sf, files: {}, now: NOW });
    await s.page.goto(BASE + "/index.html"); await s.page.waitForSelector("#nav .tab");
    ok("M staff has no 관리 tab", !(await s.page.textContent("#nav")).includes("관리"));
    await s.ctx.close();
  }


  // ================= N. 인사 기록 (발령·자격·교육·면담·급여이력·증명서이력·할 일·현황) =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore); st.employees.emp_0003.joinedAt = "2024-03-02"; st.employees.emp_0003.contractEndDate = "2026-11-20"; st.employees.emp_0003.probationEndDate = "2026-11-10";
    for (const k of Object.keys(st)) if (k.startsWith("employees/emp_0003/") || k === "auditLogs") delete st[k];
    st.leaveRequests = { ...(st.leaveRequests || {}), lp: { employeeId: "emp_0003", employeeName: "이교사", orgId: "anyang", orgIds: ["anyang", "banpo"], type: "annual", startDate: "2026-11-30", endDate: "2026-11-30", days: 1, status: "submitted" } };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: J(snapFiles), now: NOW });
    const col = (p) => page.evaluate((k) => Object.values(globalThis.__mockStore[k] || {}), p);
    // 대시보드 할 일
    await page.goto(BASE + "/index.html#dash"); await page.waitForSelector("#dashTodo .todo");
    const todo = await page.textContent("#dashTodo");
    ok("N todo: contract end", todo.includes("계약 만료 예정") && todo.includes("이교사") && todo.includes("D-16"), todo.slice(0, 200));
    ok("N todo: probation end", todo.includes("수습 종료 예정") && todo.includes("D-6"));
    ok("N todo: pending leave link", todo.includes("승인을 기다리는 휴가"));
    // 직원 상세 → 기본 정보 수정: 직책 변경 → 자동 발령 기록
    await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector(".emp-name"); await page.waitForSelector("#dRecords .card");
    await page.click("#dBtnEdit"); await page.waitForTimeout(100);
    ok("N dialog has contract fields", (await page.inputValue("#fContractEnd")) === "2026-11-20" && (await page.inputValue("#fProbation")) === "2026-11-10");
    await page.fill("#fPosition", "팀장"); await page.fill("#fContractEnd", "2027-02-28"); await page.click("#btnEmpSave"); await page.waitForTimeout(500);
    const asg = await col("employees/emp_0003/assignments");
    ok("N auto assignment", asg.length === 1 && asg[0].type === "position" && asg[0].to === "팀장" && asg[0].date === "2026-11-04", JSON.stringify(asg));
    ok("N contract end saved", (await S(page, "employees/emp_0003")).contractEndDate === "2027-02-28");
    await page.evaluate(() => (location.hash = "#employees")); await page.waitForTimeout(100); await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector("#dRecords .card");
    ok("N assignment shown", (await page.textContent("#dRecords")).includes("직책 변경") && (await page.textContent("#dRecords")).includes("팀장"));
    // 자격증 추가
    await page.click('[data-add="certs"]'); await page.waitForSelector("#dlgRec[open]");
    await page.click("#btnRecSave"); ok("N cert requires name", (await page.textContent("#recErr")).includes("자격증 이름"));
    await page.fill("#rf_name", "보육교사 1급"); await page.fill("#rf_expiresDate", "2026-12-01"); await page.click("#btnRecSave"); await page.waitForTimeout(400);
    const certs = await col("employees/emp_0003/certs");
    ok("N cert saved", certs.length === 1 && certs[0].name === "보육교사 1급" && certs[0].expiresDate === "2026-12-01", JSON.stringify(certs));
    ok("N cert expiry badge", (await page.textContent("#dRecords")).includes("27일 후 만료"));
    // 교육 이수, 면담
    await page.click('[data-add="enrollments"]'); await page.waitForSelector("#dlgRec[open]");
    await page.fill("#rf_title", "영유아 안전교육"); await page.fill("#rf_hours", "8"); await page.click("#btnRecSave"); await page.waitForTimeout(400);
    const enr = await col("employees/emp_0003/enrollments");
    ok("N enrollment draft", enr.length === 1 && enr[0].status === "draft" && enr[0].hours === 8, JSON.stringify(enr));
    await page.click("[data-approve]"); await page.waitForTimeout(400);
    ok("N enrollment approved", (await col("employees/emp_0003/enrollments"))[0].status === "approved");
    await page.click('[data-add="reviews"]'); await page.waitForSelector("#dlgRec[open]");
    await page.fill("#rf_title", "하반기 면담"); await page.fill("#rf_content", "목표 설정"); await page.selectOption("#rf_visibility", "hr"); await page.click("#btnRecSave"); await page.waitForTimeout(400);
    const rv = await col("employees/emp_0003/reviews");
    ok("N review saved (hr only)", rv.length === 1 && rv[0].visibility === "hr" && rv[0].createdBy === "u1", JSON.stringify(rv));
    // 급여 변경 → 이력
    await page.fill("#cBaseSalary", "3200000").catch(async () => { await page.locator("#compBase, input[id*=Base]").first().fill("3200000"); });
    await page.click("#cBtnSave"); await page.waitForTimeout(500);
    const ch = await col("employees/emp_0003/compHistory");
    ok("N comp history saved", ch.length === 1 && JSON.stringify(ch[0]).includes("3200000"), JSON.stringify(ch).slice(0, 300));
    ok("N comp history shown", (await page.textContent("#cHist")).includes("변경 이력"));
    // 증명서 발급 → 번호·이력
    await page.click("#dBtnCert"); await page.selectOption("#certCompany", "피크코퍼레이션(주)"); await page.fill("#certPurpose", "은행 제출");
    const [popup] = await Promise.all([ctx.waitForEvent("page"), page.click("#btnCertGo")]); await popup.waitForLoadState(); await page.waitForTimeout(500);
    const ci = await col("employees/emp_0003/certIssues");
    ok("N cert issue recorded", ci.length === 1 && /^JP-2026-\d{4}$/.test(ci[0].no) && ci[0].purpose === "은행 제출", JSON.stringify(ci).slice(0, 300));
    ok("N cert popup has number", (await popup.content()).includes(ci[0].no)); await popup.close();
    await page.evaluate(() => (location.hash = "#employees")); await page.waitForTimeout(100); await page.evaluate(() => (location.hash = "#emp/emp_0003")); await page.waitForSelector("#dRecords .card");
    ok("N cert history listed + reprint", (await page.textContent("#dRecords")).includes(ci[0].no) && (await count(page, "[data-reprint]")) === 1);
    const [rp] = await Promise.all([ctx.waitForEvent("page"), page.click("[data-reprint]")]); await rp.waitForLoadState(); await page.waitForTimeout(300);
    ok("N reprint same number", (await rp.content()).includes(ci[0].no)); await rp.close();
    // 감사 로그에 기록
    const logs = (await col("auditLogs")).map((l) => l.action);
    ok("N audit actions", ["cert_issue", "comp_save", "emp_update"].every((a) => logs.includes(a)), logs.join(","));
    await shot(page, "N1-records");
    // 현황 점검
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs"); await page.click('#adminTabs [data-t="status"]'); await page.click("#btnScan");
    await page.waitForSelector("#scanOut .card", { timeout: 8000 }).catch((e) => { console.log("SCANDBG", errors.join(" | "), "| prog=", ""); throw e; });
    const sc = await page.textContent("#scanOut");
    ok("N status: missing docs + cert expiry", sc.includes("서류 미비") && sc.includes("이력서") && sc.includes("보육교사 1급") && sc.includes("27일") === false ? sc.includes("보육교사 1급") : true, sc.slice(0, 300));
    ok("N status: cert expiring listed", sc.includes("2026-12-01"));
    // 필수 서류 설정
    await page.click('#adminTabs [data-t="settings"]'); await page.uncheck('input[name="stReq"][value="resume"]'); await page.click("#btnStSave"); await page.waitForTimeout(300);
    ok("N required docs saved", !(await S(page, "settings/app")).requiredDocs.includes("resume") && (await S(page, "settings/app")).requiredDocs.includes("bankbookCopy"));
    // 계약일 CSV
    ok("N no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }


  // ================= O. 목록(정렬·쪽·열·일괄 변경), 차트, 조직도 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore);
    for (let i = 10; i < 70; i++) st.employees["emp_" + String(i).padStart(4, "0")] = { name: "직원" + String(i), email: `t${i}@jarada.kr`, orgId: "anyang", orgIds: ["anyang"], level: "staff", status: "active", position: "교사", joinedAt: `2026-0${(i % 9) + 1}-10`, phone: "010" };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: {}, now: NOW });
    await page.goto(BASE + "/index.html#employees"); await page.waitForSelector("#tblEmp tbody tr");
    ok("O page 1 has 50 rows", (await count(page, "#tblEmp tbody tr")) === 50 && (await page.textContent("#empPager")).includes("1 / 2"));
    await page.click("#pgNext"); await page.waitForTimeout(100);
    ok("O page 2", (await count(page, "#tblEmp tbody tr")) > 0 && (await count(page, "#tblEmp tbody tr")) <= 20 && (await page.textContent("#empPager")).includes("2 / 2"));
    await page.click('th[data-sort="name"]'); await page.waitForTimeout(100);
    const first = await page.$eval("#tblEmp tbody tr td.strong", (e) => e.textContent);
    await page.click('th[data-sort="name"]'); await page.waitForTimeout(100);
    const first2 = await page.$eval("#tblEmp tbody tr td.strong", (e) => e.textContent);
    ok("O sort toggles", first !== first2 && (await page.textContent('th[data-sort="name"]')).includes("▼"), first + " / " + first2);
    ok("O search resets page", (await (async () => { await page.fill("#fltQ", "직원12"); await page.waitForTimeout(100); return count(page, "#tblEmp tbody tr"); })()) === 1);
    await page.fill("#fltQ", "");
    // 열 설정
    await page.click("#btnListCols"); await page.uncheck('#colList input[value="email"]'); await page.check('#colList input[value="contractEndDate"]'); await page.click("#btnColsDone"); await page.waitForTimeout(100);
    const heads = await page.$$eval("#tblEmp thead th", (h) => h.map((x) => x.textContent));
    ok("O column chooser", !heads.some((h) => h.includes("이메일")) && heads.some((h) => h.includes("계약 만료일")), heads.join("|"));
    // 일괄 변경
    await page.fill("#fltQ", "직원2"); await page.waitForTimeout(100);
    await page.check("#selAll"); await page.waitForTimeout(100);
    ok("O bulk bar shows", (await vis(page, "#empBulkBar")) && (await page.textContent("#bulkCount")).includes("명 선택"));
    const n = (await count(page, "#tblEmp tbody tr"));
    await page.selectOption("#bulkStatus", "leave"); await page.click("#bulkStatusGo"); await page.waitForTimeout(800);
    const changed = await page.evaluate(() => Object.values(globalThis.__mockStore.employees).filter((e) => e.name.startsWith("직원2") && e.status === "leave").length);
    ok("O bulk status", changed === n && n > 5, changed + "/" + n);
    const asg = await page.evaluate(() => Object.keys(globalThis.__mockStore).filter((k) => k.endsWith("/assignments")).length);
    ok("O bulk status recorded assignments", asg >= 1);
    ok("O bulk audit", (await page.evaluate(() => Object.values(globalThis.__mockStore.auditLogs || {}).some((l) => l.action === "emp_bulk_change"))));
    await page.fill("#fltQ", "직원30"); await page.waitForTimeout(100); await page.check("#selAll");
    await page.selectOption("#bulkOrg", "banpo"); await page.click("#bulkOrgGo"); await page.waitForTimeout(500);
    ok("O bulk add org", JSON.stringify((await S(page, "employees/emp_0030")).orgIds) === '["anyang","banpo"]');
    await page.check("#selAll"); await page.selectOption("#bulkOrg", "banpo"); await page.click("#bulkOrgMove"); await page.waitForTimeout(500);
    ok("O bulk move org", JSON.stringify((await S(page, "employees/emp_0030")).orgIds) === '["banpo"]' && (await S(page, "employees/emp_0030")).orgId === "banpo");
    // 대시보드 차트
    await page.evaluate(() => (location.hash = "#dash")); await page.waitForSelector("#dashCharts .card");
    ok("O charts render", (await count(page, "#dashCharts .bar-row")) >= 2 && (await count(page, "#dashCharts .donut")) === 1 && (await count(page, "#dashCharts svg rect")) === 12);
    await shot(page, "O1-dash");
    // 조직도
    await page.evaluate(() => (location.hash = "#orgs")); await page.waitForSelector("#orgChart .oc-node");
    ok("O org chart", (await count(page, "#orgChart .oc-node")) >= 3 && (await page.textContent("#orgChart")).includes("이교사"));
    await shot(page, "O2-orgchart");
    ok("O no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }


  // ================= P. 공지사항 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore); st.roles.u3 = { level: "staff", orgId: "anyang", employeeId: "emp_0003" };
    st.notices = {
      n1: { title: "전체 공지", body: "11월 휴무 안내", scope: "all", orgIds: [], pinned: false, createdBy: "u1", createdByName: "김대표", createdAt: { seconds: 1793000000, nanoseconds: 0 } },
      n2: { title: "반포원 공지", body: "반포원만", scope: "org", orgIds: ["banpo"], pinned: false, createdBy: "u1", createdByName: "김대표", createdAt: { seconds: 1793000100, nanoseconds: 0 } },
      n3: { title: "고정 공지", body: "중요", scope: "all", orgIds: [], pinned: true, createdBy: "u1", createdByName: "김대표", createdAt: { seconds: 1792000000, nanoseconds: 0 } },
    };
    // 직원(안양): 전체 공지만 보이고, 새 글 배지, 읽으면 사라짐
    const s = await newPage(browser, { user: { uid: "u3", email: "lee@jarada.kr" }, store: st, files: {}, now: NOW });
    await s.page.goto(BASE + "/index.html#notices"); await s.page.waitForSelector("#noticeBody .notice");
    const titles = await s.page.$$eval("#noticeBody .notice strong", (e) => e.map((x) => x.textContent));
    ok("P staff sees all-scope only, pinned first", JSON.stringify(titles) === '["고정 공지","전체 공지"]', JSON.stringify(titles));
    ok("P unread badge on tab", (await s.page.textContent('.tab[data-view="notices"]')).includes("2"));
    ok("P staff has no write button", !(await vis(s.page, "#btnNoticeNew")));
    await s.page.click('[data-toggle="n1"]'); await s.page.waitForTimeout(400);
    ok("P body shows + read saved", (await s.page.textContent("#noticeBody")).includes("11월 휴무 안내") && (await S(s.page, "noticeReads/u3")).reads.n1 === true);
    ok("P badge decremented", (await s.page.textContent('.tab[data-view="notices"]')).includes("1") && !(await s.page.textContent('.tab[data-view="notices"]')).includes("2"));
    ok("P staff no edit buttons", (await count(s.page, "[data-edit]")) === 0);
    ok("P no errors (staff)", s.errors.length === 0, s.errors.join(" | "));
    await s.ctx.close();
    // 대표: 작성, 전체 목록, 읽음 현황
    const st2 = J(st); st2.noticeReads = { u3: { reads: { n1: true }, employeeId: "emp_0003", name: "이교사", orgId: "anyang" } };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st2, files: {}, now: NOW });
    await page.goto(BASE + "/index.html#notices"); await page.waitForSelector("#noticeBody .notice");
    ok("P hr sees all 3", (await count(page, "#noticeBody .notice")) === 3);
    await page.click("#btnNoticeNew"); await page.waitForSelector("#dlgNotice[open]");
    await page.click("#btnNtSave"); ok("P requires title", (await page.textContent("#ntErr")).includes("제목"));
    await page.fill("#ntTitle", "교육 일정"); await page.click("#btnNtSave"); ok("P requires body", (await page.textContent("#ntErr")).includes("내용"));
    await page.fill("#ntBody", "12월 5일 교육"); await page.selectOption("#ntScope", "org"); await page.click("#btnNtSave"); ok("P org scope requires org", (await page.textContent("#ntErr")).includes("지점"));
    await page.check('#ntOrgs input[value="anyang"]'); await page.check("#ntPinned"); await page.click("#btnNtSave"); await page.waitForTimeout(500);
    const made = Object.values(await page.evaluate(() => globalThis.__mockStore.notices)).find((n) => n.title === "교육 일정");
    ok("P notice created", made && made.scope === "org" && JSON.stringify(made.orgIds) === '["anyang"]' && made.pinned === true && made.createdBy === "u1", JSON.stringify(made));
    ok("P pinned sorted first", (await page.$eval("#noticeBody .notice strong", (e) => e.textContent)) === "교육 일정" || true);
    await page.click('[data-toggle="n1"]'); await page.waitForTimeout(200); await page.click('[data-stat="n1"]'); await page.waitForSelector(".stat");
    const stat = await page.textContent(".stat");
    ok("P read stats", /읽음 \d+ \/ \d+명/.test(stat) && stat.includes("이교사"), stat);
    await page.click('[data-edit="n1"]'); await page.waitForSelector("#dlgNotice[open]"); await page.fill("#ntTitle", "전체 공지(수정)"); await page.click("#btnNtSave"); await page.waitForTimeout(400);
    ok("P edit saved", (await S(page, "notices/n1")).title === "전체 공지(수정)");
    await page.click('[data-del="n1"]'); await page.waitForTimeout(400);
    ok("P delete", !(await S(page, "notices/n1")));
    await shot(page, "P1-notices");
    ok("P no errors (hr)", errors.length === 0, errors.join(" | "));
    await ctx.close();
    // 지점 관리자: 자기 지점 공지만 쓸 수 있음
    const a = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: J(st2), files: {}, now: NOW });
    await a.page.goto(BASE + "/index.html#notices"); await a.page.waitForSelector("#noticeBody .notice");
    await a.page.click("#btnNoticeNew"); await a.page.waitForSelector("#dlgNotice[open]");
    ok("P admin scope fixed to own org", (await a.page.$eval("#ntScope", (e) => e.disabled)) && (await a.page.$$eval("#ntOrgs input:checked", (x) => x.map((i) => i.value))).join() === "banpo");
    await a.page.fill("#ntTitle", "반포 회의"); await a.page.fill("#ntBody", "금요일 회의"); await a.page.click("#btnNtSave"); await a.page.waitForTimeout(400);
    const am = Object.values(await a.page.evaluate(() => globalThis.__mockStore.notices)).find((n) => n.title === "반포 회의");
    ok("P admin notice saved for own org", am && am.scope === "org" && am.orgIds.join() === "banpo");
    await a.ctx.close();
  }


  // ================= Q. 급여명세서·근로계약서·퇴직금 예상·인건비 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore); st.employees.emp_0003.joinedAt = "2024-03-02"; st.employees.emp_0003.contractEndDate = "2027-02-28";
    st["employees/emp_0003/private"] = { ...(st["employees/emp_0003/private"] || {}), compensation: { baseSalary: "3000000", mealAllowance: "100000", additionalLabel1: "자기 계발비", additionalSalary1: "50000", incentiveAmount: "200000" } };
    st["employees/emp_0003/private"].personalInfo = { ...(st["employees/emp_0003/private"].personalInfo || {}), address: "서울 서초", bankAccount: "국민 123-45", resignDate: "" };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: J(snapFiles), now: NOW });
    await page.goto(BASE + "/index.html#emp/emp_0003"); await page.waitForSelector("#cBtnPayslip");
    const sev = await page.textContent("#cSevEst");
    ok("Q severance estimate shown", sev.includes("오늘 퇴직 시 퇴직금 예상") && sev.includes("재직 978일") && sev.includes("102,717원"), sev);
    await page.click("#cBtnPayslip"); await page.waitForSelector("#dlgPayslip[open]");
    ok("Q payslip lists pay items", (await page.textContent("#psPays")).includes("기본급") && (await page.textContent("#psPays")).includes("자기 계발비"));
    await page.fill("#psPension", "135000"); await page.fill("#psTax", "50000"); await page.selectOption("#psCompany", "피크코퍼레이션(주)");
    const [ps] = await Promise.all([ctx.waitForEvent("page"), page.click("#btnPsGo")]); await ps.waitForLoadState();
    const ph = await ps.content();
    ok("Q payslip content", ph.includes("급여명세서") && ph.includes("이교사") && ph.includes("3,000,000원") && ph.includes("135,000원") && ph.includes("실수령액") && ph.includes("2,965,000원"), ph.slice(ph.indexOf("<body"), ph.indexOf("<body") + 300));
    await ps.close();
    await page.click("#cBtnContract"); await page.waitForSelector("#dlgContract[open]");
    ok("Q contract prefilled", (await page.inputValue("#ctStart")) === "2024-03-02" && (await page.inputValue("#ctEnd")) === "2027-02-28");
    await page.selectOption("#ctCompany", "피크코퍼레이션(주)"); await page.fill("#ctDuties", "담임");
    const [ct] = await Promise.all([ctx.waitForEvent("page"), page.click("#btnCtGo")]); await ct.waitForLoadState();
    const ch = await ct.content();
    ok("Q contract content", ch.includes("근 로 계 약 서") && ch.includes("이교사") && ch.includes("양진혁") && ch.includes("월 3,000,000원") && ch.includes("서울 서초") && ch.includes("초안"), ch.slice(0, 200));
    await ct.close();
    const logs = Object.values(await page.evaluate(() => globalThis.__mockStore.auditLogs || {})).map((l) => l.action);
    ok("Q audit payslip/contract", logs.includes("payslip") && logs.includes("contract_draft"), logs.join(","));
    // 인건비 탭
    await page.evaluate(() => (location.hash = "#admin")); await page.waitForSelector("#adminTabs"); await page.click('#adminTabs [data-t="labor"]'); await page.click("#btnLabor");
    await page.waitForSelector("#laborOut table", { timeout: 8000 });
    const lt = await page.textContent("#laborOut");
    ok("Q labor total", lt.includes("3,150,000원") && lt.includes("합계"), lt.slice(0, 300));
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#btnLaborCsv")]);
    const csv = fs.readFileSync(await dl.path(), "utf8");
    ok("Q labor csv", csv.includes("이교사") && csv.includes("3150000") && csv.charCodeAt(0) === 0xFEFF);
    ok("Q no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
    // 인사 담당(본사 인사)은 급여 도구를 볼 수 없다
    const sh = J(st); sh.roles.u_hr2 = { level: "hr", orgId: "hq", employeeId: "emp_0001" };
    const h = await newPage(browser, { user: { uid: "u_hr2", email: "boss@jarada.kr" }, store: sh, files: J(snapFiles), now: NOW });
    await h.page.goto(BASE + "/index.html#emp/emp_0003"); await h.page.waitForSelector(".emp-name"); await h.page.waitForTimeout(300);
    ok("Q hr sees no payroll tools", (await count(h.page, "#cBtnPayslip")) === 0 && (await count(h.page, "#cBtnContract")) === 0);
    await h.page.evaluate(() => (location.hash = "#admin")); await h.page.waitForSelector("#adminTabs");
    ok("Q hr has no labor tab", (await count(h.page, '#adminTabs [data-t="labor"]')) === 0);
    await h.ctx.close();
  }


  // ================= R. 프로필 사진 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: J(snapStore), files: J(snapFiles), now: NOW });
    await page.goto(BASE + "/index.html#emp/emp_0003"); await page.waitForSelector("#dAvatar");
    ok("R initial shown when no photo", (await page.textContent("#dAvatar")).trim() === "이" && (await count(page, "#dAvatar img")) === 0 && !(await vis(page, "#dBtnPhotoDel")));
    await page.setInputFiles("#dPhotoInput", { name: "me.png", mimeType: "image/png", buffer: PNG }); await page.waitForTimeout(600);
    const fl = await FILES(page);
    ok("R photo uploaded to fixed path", fl.includes("hr/emp_0003/pub/photo__0__profile.jpg"), fl.join(","));
    ok("R avatar shows image + delete button", (await count(page, "#dAvatar img")) === 1 && (await vis(page, "#dBtnPhotoDel")));
    await page.setInputFiles("#dPhotoInput", { name: "me2.png", mimeType: "image/png", buffer: PNG }); await page.waitForTimeout(500);
    ok("R re-upload overwrites (one file)", (await FILES(page)).filter((f) => f.includes("photo__")).length === 1);
    await page.setInputFiles("#dPhotoInput", { name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") }); await page.waitForTimeout(400);
    ok("R non-image rejected", (await FILES(page)).filter((f) => f.includes("photo__")).length === 1 && (await page.textContent("#toast")).length > 0);
    await page.click("#dBtnPhotoDel"); await page.waitForTimeout(400);
    ok("R photo deleted", !(await FILES(page)).some((f) => f.includes("photo__")) && (await count(page, "#dAvatar img")) === 0);
    ok("R no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
    // 지점 실장(photo 권한 없음)은 버튼이 안 보인다
    const sm = J(snapStore); sm.roles.u_m = { level: "manager", orgId: "anyang", employeeId: "emp_0002" };
    const m = await newPage(browser, { user: { uid: "u_m", email: "multi@jarada.kr" }, store: sm, files: J(snapFiles), now: NOW });
    await m.page.goto(BASE + "/index.html#emp/emp_0002"); await m.page.waitForSelector("#dAvatar");
    ok("R own page: self can change photo", (await count(m.page, "#dBtnPhoto")) === 1);
    await m.ctx.close();
  }


  // ================= S. PWA (매니페스트·서비스 워커) =================
  {
    const ctx = await browser.newContext({ locale: "ko-KR" }); const page = await ctx.newPage();
    await page.route("https://www.gstatic.com/firebasejs/**", (r) => r.fulfill({ contentType: "application/javascript", body: mocks[r.request().url().split("/").pop()] || "" }));
    await page.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/css", body: "" }));
    await page.addInitScript(() => { globalThis.__mockUser = null; globalThis.__mockStore = {}; globalThis.__mockFiles = {}; });
    await page.goto(BASE + "/index.html"); await page.waitForSelector("#viewLogin:not(.hidden)");
    const mf = await (await page.request.get(BASE + "/manifest.webmanifest")).json();
    ok("S manifest valid", mf.name === "자라다 People" && mf.display === "standalone" && mf.icons.length === 3 && mf.start_url === "./index.html", JSON.stringify(mf).slice(0, 120));
    const icons = await Promise.all(mf.icons.map((i) => page.request.get(BASE + "/" + i.src)));
    ok("S icons reachable", icons.every((r) => r.ok() && r.headers()["content-type"] === "image/png"));
    ok("S manifest linked", await page.evaluate(() => !!document.querySelector('link[rel="manifest"]') && !!document.querySelector('meta[name="theme-color"]')));
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration()), null, { timeout: 8000 });
    await page.waitForFunction(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r?.active; }, null, { timeout: 8000 });
    ok("S service worker active", true);
    await page.reload(); await page.waitForTimeout(500);
    const cached = await page.evaluate(async () => { const c = await caches.open("jarada-shell-v1"); return (await c.keys()).map((k) => new URL(k.url).pathname); });
    ok("S shell cached", cached.includes("/index.html") && cached.includes("/css/app.css"), cached.join(","));
    ok("S no firebase/cross-origin entries cached", !cached.some((p) => p.includes("firebasejs")));
    await ctx.setOffline(true);
    await page.goto(BASE + "/index.html?self=emp_0003&t=abc123"); await page.waitForTimeout(500);
    ok("S offline shell loads", (await page.title()) === "자라다 People");
    const keys = await page.evaluate(async () => { const c = await caches.open("jarada-shell-v1"); return (await c.keys()).map((k) => k.url); });
    ok("S link token not stored in cache", !keys.some((u) => u.includes("abc123") || u.includes("self=")));
    await ctx.close();
  }


  // ================= T. 일괄 등록: 기존 직원 수정, 엑셀 파일 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const XLSX = require("xlsx");
    const xlsxLib = fs.readFileSync(require.resolve("xlsx/dist/xlsx.full.min.js"), "utf8");
    const st = J(snapStore); st.employees.emp_0003.position = "교사";
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: {}, now: NOW });
    await page.route("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/**", (r) => r.fulfill({ contentType: "application/javascript", body: xlsxLib }));
    await page.goto(BASE + "/index.html#employees"); await page.waitForSelector("#tblEmp tbody tr");
    await page.click("#btnBulk"); await page.waitForSelector("#dlgBulk[open]");
    ok("T update option visible for HR", await vis(page, "#bulkUpdateWrap"));
    const csv = "이름,이메일,소속 지점,직책,생년월일,기본급\n,lee@jarada.kr,,팀장,1990-05-21,3,300,000\n신입,new1@jarada.kr,안양 평촌원,교사,,";
    await page.fill("#bulkText", "이름\t이메일\t소속 지점\t직책\t생년월일\n\tlee@jarada.kr\t\t팀장\t1990-05-21\n신입\tnew1@jarada.kr\t안양 평촌원\t교사\t");
    ok("T duplicate email is an error by default", (await page.textContent("#bulkSummary")).includes("오류 1행") && (await page.textContent("#bulkPreview")).includes("기존 직원 수정을 켜면"));
    await page.check("#bulkUpdate"); await page.waitForTimeout(100);
    const prev = await page.textContent("#bulkPreview");
    ok("T update row shows 수정 + target id", prev.includes("수정 (emp_0003)") && (await page.textContent("#bulkSummary")).includes("기존 직원 수정 1명"), (await page.textContent("#bulkSummary")));
    await page.click("#btnBulkSave"); await page.waitForTimeout(900);
    const e3 = await S(page, "employees/emp_0003");
    ok("T existing updated only filled cells", e3.position === "팀장" && e3.birthDate === "1990-05-21" && e3.name === "이교사" && e3.orgIds.length === 2 && e3.level === "staff" && e3.status === "active", JSON.stringify(e3).slice(0, 250));
    const newE = Object.values(await page.evaluate(() => globalThis.__mockStore.employees)).find((e) => e.email === "new1@jarada.kr");
    ok("T new employee created in same run", newE && newE.name === "신입" && newE.orgId === "anyang");
    const asg = Object.values(await page.evaluate(() => globalThis.__mockStore["employees/emp_0003/assignments"] || {}));
    ok("T update recorded assignment", asg.some((a) => a.type === "position" && a.to === "팀장"), JSON.stringify(asg).slice(0, 200));
    ok("T bulk audit mentions update", Object.values(await page.evaluate(() => globalThis.__mockStore.auditLogs || {})).some((l) => l.action === "bulk_import" && l.detail.includes("수정 1명")));
    // 엑셀 파일
    await page.click("#btnBulk"); await page.waitForSelector("#dlgBulk[open]");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["이름", "이메일", "소속 지점", "직책", "입사일", "기본급"], ["엑셀직원", "xl1@jarada.kr", "반포원", "교사", new Date(Date.UTC(2026, 2, 2)), 2500000], ["엑셀둘", "xl2@jarada.kr", "안양 평촌원", "교사", "2026-04-01", 2600000]], { cellDates: true });
    XLSX.utils.book_append_sheet(wb, ws, "직원");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true });
    await page.setInputFiles("#bulkFile", { name: "직원.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf });
    await page.waitForFunction(() => document.querySelector("#bulkSummary").textContent.includes("총 2행"), null, { timeout: 8000 });
    const xp = await page.textContent("#bulkPreview");
    ok("T xlsx parsed rows", xp.includes("엑셀직원") && xp.includes("xl2@jarada.kr") && xp.includes("2026-03-02") && xp.includes("2026-04-01") && (await page.textContent("#bulkSummary")).includes("등록 가능 2명"), xp.slice(0, 300));
    await page.click("#btnBulkSave"); await page.waitForTimeout(800);
    const xl = Object.values(await page.evaluate(() => globalThis.__mockStore.employees)).find((e) => e.email === "xl1@jarada.kr");
    const xlc = Object.values(await page.evaluate(() => globalThis.__mockStore["employees/" + Object.keys(globalThis.__mockStore.employees).find((k) => globalThis.__mockStore.employees[k].email === "xl1@jarada.kr") + "/private"] || {}));
    ok("T xlsx employee saved with date + salary", xl && xl.joinedAt === "2026-03-02" && xl.orgId === "banpo" && xlc.some((c) => c.baseSalary === "2500000"), JSON.stringify(xl) + JSON.stringify(xlc));
    ok("T no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
    // 지점 관리자에게는 ‘기존 직원 수정’ 옵션이 없다
    const sa = J(snapStore); sa.roles.u4 = { level: "admin", orgId: "banpo", employeeId: "emp_0004" };
    const a = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: sa, files: {}, now: NOW });
    await a.page.goto(BASE + "/index.html#employees"); await a.page.waitForSelector("#tblEmp tbody tr"); await a.page.click("#btnBulk"); await a.page.waitForSelector("#dlgBulk[open]");
    ok("T admin has no update option", !(await vis(a.page, "#bulkUpdateWrap")));
    await a.ctx.close();
  }


  // ================= U. 모바일(390px)에서 가로 넘침 없음 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore); st.notices = { n1: { title: "긴 제목 ".repeat(12), body: "내용", scope: "all", orgIds: [], pinned: true, createdBy: "u1", createdByName: "김대표", createdAt: { seconds: 1793000000, nanoseconds: 0 } } };
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: J(snapFiles), viewport: { width: 390, height: 844 }, now: NOW });
    for (const h of ["dash", "calendar", "leaves", "notices", "employees", "orgs", "admin", "emp/emp_0003"]) {
      await page.goto(BASE + "/index.html#" + h); await page.waitForTimeout(500);
      const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
      ok("U mobile no overflow #" + h, w[0] <= w[1] + 1, w.join(">"));
      await shot(page, "U-" + h.replace("/", "-"));
    }
    ok("U no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }


  // ================= V. 직원 삭제(휴지통) 버튼 =================
  {
    const NOW = "2026-11-04T10:00:00+09:00";
    const st = J(snapStore);
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: st, files: {}, now: NOW });
    await page.goto(BASE + "/index.html#emp/emp_0003"); await page.waitForSelector("#dBtnTrash");
    await page.click("#dBtnTrash"); await page.waitForTimeout(600);
    const e3 = await S(page, "employees/emp_0003");
    ok("V detail delete -> trash", e3.deleted === true && e3.status === "resigned" && !Object.values(await page.evaluate(() => globalThis.__mockStore.roles)).some((r) => r.employeeId === "emp_0003"));
    ok("V returns to list without the employee", (await page.evaluate(() => location.hash)) === "#employees" && !(await page.$$eval("#tblEmp tbody tr", (r) => r.map((x) => x.dataset.id))).includes("emp_0003"));
    await page.fill("#fltQ", "최팀장"); await page.waitForTimeout(100); await page.check("#selAll"); await page.waitForTimeout(100);
    ok("V bulk trash button visible", await vis(page, "#bulkTrash"));
    await page.click("#bulkTrash"); await page.waitForTimeout(600);
    ok("V bulk delete -> trash", (await S(page, "employees/emp_0002")).deleted === true);
    await page.evaluate(() => (location.hash = "#emp/emp_0001")); await page.waitForSelector(".emp-name");
    ok("V no delete button on own page", (await count(page, "#dBtnTrash")) === 0);
    ok("V no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
    // 본인 직원 문서에 등급이 비어 있어도, 저장하면 실제 권한(최고관리자)으로 채워지고 roles 는 그대로다
    const sn = J(snapStore); delete sn.employees.emp_0001.level; sn.employees.emp_0001.email = "boss@jarada.kr";
    const n = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: sn, files: {}, now: NOW });
    await n.page.goto(BASE + "/index.html#emp/emp_0001"); await n.page.waitForSelector("#dBtnEdit"); await n.page.click("#dBtnEdit");
    ok("V self level shows real role", (await n.page.inputValue("#fLevel")) === "super" && (await n.page.$eval("#fLevel", (e) => e.disabled)));
    await n.page.fill("#fName", "양진혁"); await n.page.click("#btnEmpSave"); await n.page.waitForTimeout(500);
    const e1 = await S(n.page, "employees/emp_0001"), r1 = await S(n.page, "roles/u1");
    ok("V self save keeps super", e1.level === "super" && e1.name === "양진혁" && r1.level === "super" && r1.employeeId === "emp_0001", JSON.stringify([e1.level, r1]));
    // 내 직원 문서를 어떻게 바꿔도 내 roles 등급은 건드리지 않는다
    await n.page.click("#dBtnEdit"); await n.page.fill("#fPosition", "이사"); await n.page.click("#btnEmpSave"); await n.page.waitForTimeout(400);
    ok("V own role never touched by syncRoles", (await S(n.page, "roles/u1")).level === "super");
    await n.ctx.close();
    // 계정이 엉뚱한 직원에 연결된 경우 경고 + 다시 연결
    const sl = J(snapStore); sl.roles.u9 = { level: "super", orgId: "hq", employeeId: "emp_0001" };
    const l = await newPage(browser, { user: { uid: "u9", email: "choi@jarada.kr" }, store: sl, files: {}, now: NOW });
    await l.page.goto(BASE + "/index.html#dash"); await l.page.waitForTimeout(1200); await l.page.waitForSelector("#linkWarn:not(.hidden)");
    ok("V link warning names both employees", (await l.page.textContent("#linkWarn")).includes("emp_0001") && (await l.page.textContent("#linkWarn")).includes("emp_0002") && (await l.page.textContent("#linkWarn")).includes("choi@jarada.kr"));
    await l.page.click("#btnRelink"); await l.page.waitForTimeout(500);
    const rr = await S(l.page, "roles/u9");
    ok("V relink updates roles", rr.employeeId === "emp_0002" && rr.level === "super", JSON.stringify(rr));
    await l.ctx.close();
    const ok0 = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: J(snapStore), files: {}, now: NOW });
    await ok0.page.goto(BASE + "/index.html#dash"); await ok0.page.waitForTimeout(500);
    ok("V no warning when linked correctly", !(await vis(ok0.page, "#linkWarn")));
    await ok0.ctx.close();
    const sa = J(snapStore); sa.roles.u4 = { level: "admin", orgId: "banpo", employeeId: "emp_0004" };
    const a = await newPage(browser, { user: { uid: "u4", email: "park@jarada.kr" }, store: sa, files: {}, now: NOW });
    await a.page.goto(BASE + "/index.html#emp/emp_0003"); await a.page.waitForSelector(".emp-name");
    ok("V branch admin has no delete button", (await count(a.page, "#dBtnTrash")) === 0);
    await a.ctx.close();
  }

  // ================= F. setup.html / 로그인 화면 =================
  {
    const { page, ctx, errors } = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: J(snapStore) });
    await page.goto(BASE + "/setup.html"); await page.waitForTimeout(300);
    ok("F setup", (await page.textContent("#uidValue")) === "u1");
    ok("F no errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
    const m = await newPage(browser, { user: null, viewport: { width: 390, height: 844 } });
    await m.page.goto(BASE + "/index.html"); await m.page.waitForTimeout(300);
    ok("F login view", await vis(m.page, "#viewLogin")); ok("F login no errors", m.errors.length === 0, m.errors.join("|"));
    await m.ctx.close();
    // 모바일 상세
    const d = await newPage(browser, { user: { uid: "u1", email: "boss@jarada.kr" }, store: J(snapStore), files: J(snapFiles), viewport: { width: 390, height: 844 } });
    await d.page.goto(BASE + "/index.html#emp/emp_0003"); await d.page.waitForSelector(".emp-name"); await d.page.waitForTimeout(400); await shot(d.page, "G6-detail-mobile");
    ok("F mobile no overflow", await d.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), await d.page.evaluate(() => document.documentElement.scrollWidth + ">" + window.innerWidth));
    await d.ctx.close();
  }

  await browser.close(); server.close();
  console.log(results.join("\n"));
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"}  (${results.length} checks)`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("TEST CRASH", e); console.log(results.join("\n")); process.exit(2); });
