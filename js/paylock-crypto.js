// 급여 열람 비밀번호: 해시 만들기·확인 (브라우저 WebCrypto, Node 에서도 같은 코드로 테스트 가능)
// 비밀번호 자체는 저장하지 않고, 소금(salt)을 섞어 PBKDF2-SHA256 으로 여러 번 돌린 값만 저장한다.
export const PAYLOCK_ITER = 200000;
export const MIN_LEN = 8;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));
export async function deriveHash(password, saltB64, iter = PAYLOCK_ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(String(password)), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations: iter }, key, 256));
}
export async function makeLock(password) {
  const salt = newSalt();
  return { salt, hash: await deriveHash(password, salt), iter: PAYLOCK_ITER, algo: "PBKDF2-SHA256" };
}
// 길이가 같은 두 문자열을 시간 차이 없이 비교
const same = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
export async function verifyLock(lock, password) {
  if (!lock?.salt || !lock?.hash || !password) return false;
  try { return same(await deriveHash(password, lock.salt, Number(lock.iter) || PAYLOCK_ITER), String(lock.hash)); } catch { return false; }
}
// 새 비밀번호 규칙: 8자 이상, 숫자만/같은 글자 반복은 불가 (이름·생일 같은 흔한 값은 막을 수 없으니 안내만)
export function checkNewPassword(pw, confirm) {
  if (String(pw).length < MIN_LEN) return `비밀번호는 ${MIN_LEN}자 이상이어야 합니다.`;
  if (/^(.)\1+$/.test(pw)) return "같은 글자만 반복한 비밀번호는 쓸 수 없습니다.";
  if (/^\d+$/.test(pw)) return "숫자만으로는 만들 수 없습니다. 영문이나 기호를 섞어 주세요.";
  if (confirm !== undefined && pw !== confirm) return "비밀번호 확인이 일치하지 않습니다.";
  return "";
}
