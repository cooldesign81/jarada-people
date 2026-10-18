const fs = require("fs");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const results = []; let failures = 0;
async function t(name, expectOk, fn) {
  try { await (expectOk ? assertSucceeds(fn()) : assertFails(fn())); results.push("PASS " + name); }
  catch (e) { failures++; results.push("FAIL " + name + " — " + String(e.message || e).split("\n")[0].slice(0, 160)); }
}
const emp = (o) => ({ name: "직원", email: "x@jarada.kr", orgId: "banpo", orgIds: ["banpo"], level: "staff", status: "active", ...o });
(async () => {
  const env = await initializeTestEnvironment({ projectId: "demo-jarada",
    storage: { rules: require("./make-shim.cjs")() } });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const st = ctx.storage();
    for (const p of ["hr/emp_0003/pub/resume__1__a.pdf", "hr/emp_0003/sec/bankbookCopy__1__b.jpg", "hr/emp_0005/pub/resume__1__c.pdf"]) await st.ref(p).put(new Uint8Array([1, 2, 3]));
  });
  const CL = {
  u_super: { lvl: "super", org: "hq", eid: "emp_0001" }, u_hr: { lvl: "hr", org: "hq", eid: "emp_h" },
  u_adm: { lvl: "admin", org: "banpo", eid: "emp_0004", emp_emp_0003: ["anyang", "banpo"], emp_emp_0005: ["anyang"] },
  u_adm2: { lvl: "admin", org: "anyang", eid: "emp_a2", emp_emp_0003: ["anyang", "banpo"], emp_emp_0005: ["anyang"] },
  u_staff: { lvl: "staff", org: "anyang", eid: "emp_0003" }, u_other: { lvl: "staff", org: "banpo", eid: "emp_b" } };
const S = (uid) => env.authenticatedContext(uid, CL[uid]).storage();
  const sup = S("u_super"), hr = S("u_hr"), adm = S("u_adm"), adm2 = S("u_adm2"), stf = S("u_staff"), oth = S("u_other"), anon = env.unauthenticatedContext().storage();
  const bytes = () => new Uint8Array([9, 9, 9]);
  const put = (st, p) => st.ref(p).put(bytes());
  // 읽기
  await t("anon cannot read pub", false, () => anon.ref("hr/emp_0003/pub/resume__1__a.pdf").getDownloadURL());
  await t("super reads pub", true, () => sup.ref("hr/emp_0003/pub/resume__1__a.pdf").getDownloadURL());
  await t("super lists pub", true, () => sup.ref("hr/emp_0003/pub").listAll());
  await t("super lists sec", true, () => sup.ref("hr/emp_0003/sec").listAll());
  await t("hr lists pub", true, () => hr.ref("hr/emp_0003/pub").listAll());
  await t("hr CANNOT list sec", false, () => hr.ref("hr/emp_0003/sec").listAll());
  await t("admin(banpo) lists pub of multi-org emp", true, () => adm.ref("hr/emp_0003/pub").listAll());
  await t("admin(banpo) reads pub", true, () => adm.ref("hr/emp_0003/pub/resume__1__a.pdf").getDownloadURL());
  await t("admin(banpo) CANNOT list anyang-only pub", false, () => adm.ref("hr/emp_0005/pub").listAll());
  await t("admin(banpo) CANNOT list sec", false, () => adm.ref("hr/emp_0003/sec").listAll());
  await t("admin(banpo) CANNOT read sec file", false, () => adm.ref("hr/emp_0003/sec/bankbookCopy__1__b.jpg").getDownloadURL());
  await t("staff CANNOT list own pub", false, () => stf.ref("hr/emp_0003/pub").listAll());
  await t("staff CANNOT read own sec file", false, () => stf.ref("hr/emp_0003/sec/bankbookCopy__1__b.jpg").getDownloadURL());
  // 업로드
  await t("self uploads public doc", true, () => put(stf, "hr/emp_0003/pub/diploma__5__d.pdf"));
  await t("self uploads secret doc", true, () => put(stf, "hr/emp_0003/sec/residentCopy__5__r.pdf"));
  await t("self cannot upload eval", false, () => put(stf, "hr/emp_0003/sec/eval__5__e.xlsx"));
  await t("self cannot upload etc", false, () => put(stf, "hr/emp_0003/sec/etc__5__e.png"));
  await t("self cannot upload to others", false, () => put(stf, "hr/emp_0005/pub/resume__5__x.pdf"));
  await t("self wrong key in pub", false, () => put(stf, "hr/emp_0003/pub/bankbookCopy__5__x.pdf"));
  await t("self file name without ts", false, () => put(stf, "hr/emp_0003/pub/resume__abc__x.pdf"));
  await t("other staff cannot upload to emp_0003", false, () => put(oth, "hr/emp_0003/pub/resume__6__x.pdf"));
  await t("anon cannot upload", false, () => put(anon, "hr/emp_0003/pub/resume__6__x.pdf"));
  await t("admin(banpo) uploads pub", true, () => put(adm, "hr/emp_0003/pub/portfolio__7__p.pdf"));
  await t("admin(banpo) CANNOT upload sec", false, () => put(adm, "hr/emp_0003/sec/residentCopy__7__r.pdf"));
  await t("admin(anyang) cannot upload banpo-only?? (emp_0003 includes anyang → ok)", true, () => put(adm2, "hr/emp_0003/pub/portfolio__8__p.pdf"));
  await t("super uploads eval/etc", true, () => put(sup, "hr/emp_0003/sec/eval__9__e.xlsx"));
  await t("super uploads etc", true, () => put(sup, "hr/emp_0003/sec/etc__9__e.png"));
  await t("super cannot upload junk name", false, () => put(sup, "hr/emp_0003/sec/random.txt"));
  await t("size limit (31MB) rejected", false, () => sup.ref("hr/emp_0003/sec/eval__10__big.bin").put(new Uint8Array(31 * 1024 * 1024)));
  // 삭제
  await t("admin(banpo) deletes pub", true, () => adm.ref("hr/emp_0003/pub/portfolio__7__p.pdf").delete());
  await t("admin(banpo) CANNOT delete sec", false, () => adm.ref("hr/emp_0003/sec/bankbookCopy__1__b.jpg").delete());
  await t("staff CANNOT delete", false, () => stf.ref("hr/emp_0003/pub/diploma__5__d.pdf").delete());
  await t("super deletes sec", true, () => sup.ref("hr/emp_0003/sec/bankbookCopy__1__b.jpg").delete());
  await t("other paths denied", false, () => put(sup, "other/x.txt"));

  // 프로필 사진
  const PH = "hr/emp_0003/pub/photo__0__profile.jpg";
  const putImg = (st, p, type = "image/jpeg") => st.ref(p).put(bytes(), { contentType: type });
  await t("photo: self uploads", true, () => putImg(stf, PH));
  await t("photo: self overwrites", true, () => putImg(stf, PH));
  await t("photo: self reads own photo", true, () => stf.ref(PH).getDownloadURL());
  await t("photo: self cannot read own resume", false, () => stf.ref("hr/emp_0003/pub/resume__1__a.pdf").getDownloadURL());
  await t("photo: self deletes own photo", true, () => stf.ref(PH).delete());
  await t("photo: non-image denied", false, () => putImg(stf, PH, "application/pdf"));
  await t("photo: other name denied", false, () => putImg(stf, "hr/emp_0003/pub/photo__1__x.jpg"));
  await t("photo: other staff cannot upload", false, () => putImg(oth, PH));
  await t("photo: hr uploads", true, () => putImg(hr, PH));
  await t("photo: admin(banpo) uploads", true, () => putImg(adm, PH));
  await t("photo: admin(banpo) reads", true, () => adm.ref(PH).getDownloadURL());
  await t("photo: other staff cannot read", false, () => oth.ref(PH).getDownloadURL());
  await t("photo: self cannot read other's photo", false, async () => { await env.withSecurityRulesDisabled((c) => c.storage().ref("hr/emp_0005/pub/photo__0__profile.jpg").put(new Uint8Array([1]), { contentType: "image/jpeg" })); return stf.ref("hr/emp_0005/pub/photo__0__profile.jpg").getDownloadURL(); });

  // 비공개서류: 대표이사에게는 권한 설정으로 열어 준 경우에만 (sec 클레임 = settings/permissions 의 secDocs 에 hr 포함)
  const hrSec = env.authenticatedContext("u_hr", { lvl: "hr", org: "hq", eid: "emp_h", sec: true }).storage();
  await t("secDocs off: hr cannot list sec", false, () => hr.ref("hr/emp_0003/sec").listAll());
  await t("secDocs off: hr cannot upload sec", false, () => put(hr, "hr/emp_0003/sec/eval__9__e.xlsx"));
  await t("secDocs on: hr lists sec", true, () => hrSec.ref("hr/emp_0003/sec").listAll());
  await t("secDocs on: hr uploads eval", true, () => put(hrSec, "hr/emp_0003/sec/eval__9__e.xlsx"));
  await t("secDocs on: hr reads sec file", true, () => hrSec.ref("hr/emp_0003/sec/eval__9__e.xlsx").getDownloadURL());
  await t("secDocs on: hr deletes sec file", true, () => hrSec.ref("hr/emp_0003/sec/eval__9__e.xlsx").delete());
  await t("secDocs on: branch admin still denied", false, () => adm.ref("hr/emp_0003/sec").listAll());

  // 급여·인센티브 명세서 (hr/{사번}/pay/)
  const PAY = "hr/emp_0003/pay/salary__2026-10__5__a.pdf";
  const putAs = (st, p, type = "application/pdf", size = 3) => st.ref(p).put(new Uint8Array(size), { contentType: type });
  const hrPay = env.authenticatedContext("u_hr", { lvl: "hr", org: "hq", eid: "emp_h", pay: true }).storage();
  const linkUser = env.authenticatedContext("u_link", { lvl: "staff", org: "anyang", eid: "emp_0003", link: true }).storage();
  await t("pay: super uploads pdf", true, () => putAs(sup, PAY));
  await t("pay: super uploads image", true, () => putAs(sup, "hr/emp_0003/pay/incentive__2026-10__6__b.png", "image/png"));
  await t("pay: employee (own google account) reads", true, () => stf.ref(PAY).getDownloadURL());
  await t("pay: other employee cannot read", false, () => oth.ref(PAY).getDownloadURL());
  await t("pay: registration-link user cannot read", false, () => linkUser.ref(PAY).getDownloadURL());
  await t("pay: branch admin cannot read", false, () => adm.ref(PAY).getDownloadURL());
  await t("pay: hr cannot read by default", false, () => hr.ref(PAY).getDownloadURL());
  await t("pay: employee cannot upload own", false, () => putAs(stf, "hr/emp_0003/pay/salary__2026-10__7__c.pdf"));
  await t("pay: employee cannot delete", false, () => stf.ref(PAY).delete());
  await t("pay: hr cannot upload by default", false, () => putAs(hr, "hr/emp_0003/pay/salary__2026-10__8__d.pdf"));
  await t("pay: bad content type", false, () => putAs(sup, "hr/emp_0003/pay/salary__2026-10__9__e.zip", "application/zip"));
  await t("pay: bad file name", false, () => putAs(sup, "hr/emp_0003/pay/payslip.pdf"));
  await t("pay: bad month in name", false, () => putAs(sup, "hr/emp_0003/pay/salary__10월__9__f.pdf"));
  await t("pay: over 10MB", false, () => putAs(sup, "hr/emp_0003/pay/salary__2026-10__10__g.pdf", "application/pdf", 10 * 1024 * 1024 + 1));
  await t("pay comp on: hr uploads", true, () => putAs(hrPay, "hr/emp_0003/pay/salary__2026-11__11__h.pdf"));
  await t("pay comp on: hr reads", true, () => hrPay.ref("hr/emp_0003/pay/salary__2026-11__11__h.pdf").getDownloadURL());
  await t("pay comp on: hr deletes", true, () => hrPay.ref("hr/emp_0003/pay/salary__2026-11__11__h.pdf").delete());
  await t("pay: super deletes", true, () => sup.ref(PAY).delete());
  await env.cleanup();
  console.log(results.filter((r) => r.startsWith("FAIL")).join("\n") || "(no failures)");
  console.log(`\n${results.length - failures}/${results.length} passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
