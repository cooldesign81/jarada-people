// 명세서 파일 이름에서 직원·종류·귀속 월을 찾아낸다 (순수 함수 — 화면/Firebase 없이 테스트 가능)
// 예) "2026-10_급여명세서_김교사.pdf", "emp_0003 인센티브 202610.png", "홍길동(hong@gmail.com) 10월 급여.pdf"

const nrm = (s) => String(s ?? "").normalize("NFC").replace(/\s+/g, "").toLowerCase();

export const SLIP_TYPES = { salary: "급여명세서", incentive: "인센티브 내역서" };

export function guessType(fileName, fallback = "salary") {
  const n = nrm(fileName);
  if (/인센티브|인센|성과급|incentive|bonus/.test(n)) return "incentive";
  if (/급여|월급|명세|salary|payslip|pay/.test(n)) return "salary";
  return fallback;
}

// 귀속 월: 2026-10 / 2026.10 / 2026_10 / 202610 / 2026년10월 / (연도 없이) 10월 → fallbackYear 사용
export function guessMonth(fileName, fallback = "", fallbackYear = "") {
  const s = String(fileName ?? "").normalize("NFC");
  let m = /(20\d{2})\s*[-._년/ ]\s*(0?[1-9]|1[0-2])(?!\d)/.exec(s) || /(20\d{2})(0[1-9]|1[0-2])(?!\d)/.exec(s);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  m = /(?<!\d)(0?[1-9]|1[0-2])\s*월/.exec(s);
  if (m && fallbackYear) return `${fallbackYear}-${String(m[1]).padStart(2, "0")}`;
  return fallback;
}

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
