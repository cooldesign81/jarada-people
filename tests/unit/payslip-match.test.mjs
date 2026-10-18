import { SLIP_TYPES, guessEmployee, isAllowedFile } from "../../js/payslip-match.js";
let f = 0; const eq = (n, a, b) => { const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) f++; console.log(ok ? "PASS" : "FAIL", n, ok ? "" : JSON.stringify(a) + " != " + JSON.stringify(b)); };
const E = [
  { id: "emp_0001", name: "양진혁", email: "jinhyuck@gmail.com" }, { id: "emp_0003", name: "이교사", email: "lee@jarada.kr" },
  { id: "emp_0004", name: "김수", email: "su@jarada.kr" }, { id: "emp_0005", name: "김수현", email: "suhyun@jarada.kr" },
  { id: "emp_0006", name: "박민", email: "min1@jarada.kr" }, { id: "emp_0007", name: "박민", email: "min2@jarada.kr" },
];
eq("labels", SLIP_TYPES, { salary: "급여 명세서", incentive: "급여 세부내역서" });
eq("emp name only file", guessEmployee("이교사.pdf", E).emp?.id, "emp_0003");
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
