// 명세서 파일 이름에서 직원을 찾아낸다 (순수 함수 — 화면/Firebase 없이 테스트 가능). 종류·월은 올릴 때 직접 고른다.
// 예) "김교사.pdf", "김교사_급여.png", "emp_0003.pdf", "hong@gmail.com.pdf"

const nrm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();

export const SLIP_TYPES = { salary: "급여 명세서", incentive: "급여 세부내역서" };

// 직원 찾기: 사번 → 이메일 → 이름(가장 긴 이름 우선, 같은 길이가 둘 이상이면 모호 → null)
export function guessEmployee(fileName, employees) {
  const raw = String(fileName ?? "").normalize("NFC"), n = nrm(raw);
  const id = /emp_\d+/i.exec(raw)?.[0]?.toLowerCase();
  if (id) { const e = employees.find((x) => x.id.toLowerCase() === id); if (e) return { emp: e, by: "사번" }; }
  const byMail = employees.filter((e) => e.email && n.includes(nrm(e.email)));
  if (byMail.length === 1) return { emp: byMail[0], by: "이메일" };
  const byName = employees.filter((e) => e.name && n.includes(nrm(e.name)));
  if (!byName.length) return { emp: null, by: "" };
  const longest = Math.max(...byName.map((e) => nrm(e.name).length));
  const top = byName.filter((e) => nrm(e.name).length === longest);
  return top.length === 1 ? { emp: top[0], by: "이름" } : { emp: null, by: "", ambiguous: top };
}

export function isAllowedFile(file) {
  const t = file.type || "", n = (file.name || "").toLowerCase();
  const ok = t === "application/pdf" || t.startsWith("image/") || /\.(pdf|png|jpe?g|gif|webp|heic)$/.test(n);
  if (!ok) return "PDF·이미지 파일만 올릴 수 있습니다";
  if (file.size > 10 * 1024 * 1024) return "10MB를 넘습니다";
  if (!file.size) return "빈 파일입니다";
  return "";
}
export const contentTypeOf = (file) => {
  if (file.type === "application/pdf" || (file.type || "").startsWith("image/")) return file.type;
  const n = (file.name || "").toLowerCase();
  return n.endsWith(".pdf") ? "application/pdf" : n.endsWith(".png") ? "image/png" : n.endsWith(".gif") ? "image/gif" : n.endsWith(".webp") ? "image/webp" : n.endsWith(".heic") ? "image/heic" : "image/jpeg";
};
