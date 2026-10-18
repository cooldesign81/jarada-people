// 주민등록번호 앞 6자리(+뒷자리 첫 숫자)로 생년월일을 구한다 (순수 함수 — 화면/Firebase 없이 테스트 가능)
//  · 뒷자리 첫 숫자가 있으면 세기를 정확히 안다: 1·2·5·6 → 1900년대, 3·4·7·8 → 2000년대, 9·0 → 1800년대
//  · 없으면 직원 나이가 14~85세가 되는 쪽으로 추정한다 (둘 다 안 맞으면 알 수 없음 → "")
const validDate = (y, m, d) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
const ymd = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

export function birthFromRrn(front, backFirst = "", now = new Date()) {
  if (!/^\d{6}$/.test(String(front || ""))) return "";
  const yy = Number(front.slice(0, 2)), m = Number(front.slice(2, 4)), d = Number(front.slice(4, 6));
  const b = String(backFirst || "")[0] || "";
  let century;
  if ("1256".includes(b) && b) century = 1900; else if ("3478".includes(b) && b) century = 2000; else if ("90".includes(b) && b) century = 1800;
  if (century) return validDate(century + yy, m, d) ? ymd(century + yy, m, d) : "";
  const ageOk = (y) => { if (!validDate(y, m, d)) return false; const age = now.getFullYear() - y - (now < new Date(now.getFullYear(), m - 1, d) ? 1 : 0); return age >= 14 && age <= 85; };
  const found = [1900 + yy, 2000 + yy].filter(ageOk);
  return found.length === 1 ? ymd(found[0], m, d) : "";
}
