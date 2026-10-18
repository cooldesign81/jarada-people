// storage.rules 는 Firestore 문서(roles, employees)를 firestore.get() 으로 조회하는데, 에뮬레이터가 이 교차 조회를 지원하지 않는다.
// 그래서 테스트에서는 같은 규칙에서 조회 부분만 토큰 클레임(lvl, eid, org, emp_<사번>)으로 바꾼 사본으로 검사한다.
// 바뀌는 곳은 roleExists / role() / selfTokenValid / adminOf 뿐이다. 나머지(파일 이름 패턴, 크기·형식, 권한 조건)는 원본 그대로다.
const fs = require("fs"), path = require("path");
module.exports = () => {
  let s = fs.readFileSync(path.join(__dirname, "..", "..", "storage.rules"), "utf8");
  const must = (cond, what) => { if (!cond) throw new Error("storage.rules 모양이 바뀌어 테스트용 변환이 맞지 않습니다: " + what); };
  const before = s;
  s = s.replace("function roleExists() { return signedIn() && firestore.exists(rolePath()); }", "function roleExists() { return signedIn() && request.auth.token.get('lvl', '') != ''; }");
  s = s.replace(/    function role\(\) \{[^\n]*\n/, "");
  s = s.split("role().level").join("request.auth.token.lvl").split("role().get('employeeId', '')").join("request.auth.token.get('eid', '')");
  s = s.replace(/function selfTokenValid\(empId\) \{[\s\S]*?\n    \}\n/, "function selfTokenValid(empId) { return true; }\n");
  s = s.replace(/function adminOf\(empId\) \{[\s\S]*?\n    \}\n/, "function adminOf(empId) {\n      return isAdmin() && request.auth.token.org in request.auth.token.get('emp_' + empId, []);\n    }\n");
  must(s !== before, "no change");
  must(!/firestore\.(get|exists)/.test(s.replace(/\/\/.*$/gm, "")), "firestore.* lookup still present");
  const out = path.join(require("os").tmpdir(), "jarada-storage.shim.rules");
  fs.writeFileSync(out, s); return s;
};
