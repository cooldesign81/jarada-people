import { guessType, guessMonth, guessEmployee, isAllowedFile } from "../../js/payslip-match.js";
let f = 0; const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) f++; console.log(ok ? "PASS" : "FAIL", n, ok ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)); };
const E = [
  { id: "emp_0001", name: "양진혁", email: "jinhyuck@gmail.com" }, { id: "emp_0003", name: "이교사", email: "lee@jarada.kr" },
  { id: "emp_0004", name: "김수", email: "su@jarada.kr" }, { id: "emp_0005", name: "김수현", email: "suhyun@jarada.kr" },
  { id: "emp_0006", name: "박민", email: "min1@jarada.kr" }, { id: "emp_0007", name: "박민", email: "min2@jarada.kr" },
];
eq("type 급여", guessType("2026-10_급여명세서_이교사.pdf"), "salary");
eq("type 인센티브", guessType("이교사 인센티브 내역.png"), "incentive");
eq("type incentive en", guessType("Incentive_Oct.pdf"), "incentive");
eq("type fallback", guessType("scan001.pdf", "incentive"), "incentive");
eq("month dash", guessMonth("2026-10_급여.pdf"), "2026-10");
eq("month dot", guessMonth("급여 2026.1.pdf"), "2026-01");
eq("month compact", guessMonth("급여_202611_이교사.pdf"), "2026-11");
eq("month korean", guessMonth("2026년 3월 급여.pdf"), "2026-03");
eq("month only with fallback year", guessMonth("10월 급여.pdf", "", "2026"), "2026-10");
eq("month only without year -> fallback", guessMonth("10월 급여.pdf", "2026-09"), "2026-09");
eq("month not confused with 사번", guessMonth("emp_0003 급여.pdf", "x"), "x");
eq("emp by id", guessEmployee("emp_0003 급여.pdf", E).emp?.id, "emp_0003");
eq("emp by email", guessEmployee("lee@jarada.kr_급여.pdf", E).emp?.id, "emp_0003");
eq("emp by name", guessEmployee("2026-10 이교사 급여.pdf", E).emp?.id, "emp_0003");
eq("emp longest name wins", guessEmployee("김수현_급여.pdf", E).emp?.id, "emp_0005");
eq("emp shorter name when only it matches", guessEmployee("김수_급여.pdf", E).emp?.id, "emp_0004");
eq("emp ambiguous same name", guessEmployee("박민_급여.pdf", E).emp, null);
eq("emp ambiguous list", guessEmployee("박민_급여.pdf", E).ambiguous?.length, 2);
eq("emp none", guessEmployee("scan001.pdf", E).emp, null);
eq("emp name with spaces", guessEmployee("이 교사 급여.pdf", E).emp?.id, "emp_0003");
eq("file ok pdf", isAllowedFile({ name: "a.pdf", type: "application/pdf", size: 100 }), "");
eq("file ok png by ext", isAllowedFile({ name: "a.PNG", type: "", size: 100 }), "");
eq("file bad type", isAllowedFile({ name: "a.xlsx", type: "application/vnd.ms-excel", size: 100 }), "PDF·이미지 파일만 올릴 수 있습니다");
eq("file too big", isAllowedFile({ name: "a.pdf", type: "application/pdf", size: 11 * 1024 * 1024 }), "10MB를 넘습니다");
process.exit(f ? 1 : 0);
