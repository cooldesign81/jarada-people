// 서명 전 문자 인증 (Firebase Authentication — 전화). 관리 → 설정에서 최고관리자가 켰을 때만 쓴다 (settings/app.signPhoneVerify).
// · 처음이면 로그인한 구글 계정에 전화번호를 연결(link)하고, 이미 연결돼 있으면 그 번호로 다시 인증(reauthenticate)한다.
//   → 로그인할 때마다 문자를 받지 않고, 계약서에 서명할 때만 인증한다.
// · 인증된 전화번호는 로그인 토큰(phone_number)에 실리고, Firestore 규칙이 서명한 번호(signedPhone)와 같은지 확인한다.
// 주의: 문자 인증은 법적 실명확인이 아니다 (휴대전화를 가진 사람임을 확인할 뿐).
import { auth } from "./firebase.js";
import { RecaptchaVerifier, linkWithPhoneNumber, reauthenticateWithPhoneNumber } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { state } from "./core.js";
import { toE164 } from "./contract-docs.js";

export const phoneRequired = () => state.settings?.signPhoneVerify === true;
const linkedPhone = () => auth.currentUser?.providerData?.some((p) => p.providerId === "phone") ? auth.currentUser.phoneNumber || "" : "";

let verifier = null, confirmation = null, pendingPhone = "";
export const verifiedPhone = () => (verified ? pendingPhone : "");
let verified = false;
export function resetPhone() { verified = false; confirmation = null; pendingPhone = ""; try { verifier?.clear(); } catch {} verifier = null; }

const friendly = (e) => {
  const c = String(e?.code || "");
  if (c.includes("invalid-phone-number")) return "전화번호 형식이 올바르지 않습니다.";
  if (c.includes("too-many-requests")) return "요청이 너무 많습니다. 잠시 뒤 다시 시도하세요.";
  if (c.includes("invalid-verification-code") || c.includes("code-expired")) return "인증번호가 맞지 않거나 만료됐습니다.";
  if (c.includes("credential-already-in-use") || c.includes("account-exists")) return "이 전화번호는 이미 다른 계정에 연결돼 있습니다. 담당 관리자에게 문의하세요.";
  if (c.includes("operation-not-allowed")) return "문자 인증이 아직 켜져 있지 않습니다 (Firebase 콘솔 → Authentication → 로그인 방법 → 전화).";
  if (c.includes("quota-exceeded")) return "문자 발송 한도를 초과했습니다.";
  return e?.message || "문자 인증에 실패했습니다.";
};

// 인증번호 보내기. 이미 연결된 번호가 있으면 그 번호로만 보낸다
export async function sendCode(input, container) {
  resetPhone();
  const linked = linkedPhone();
  const phone = linked || toE164(input);
  if (!/^\+\d{9,15}$/.test(phone)) throw new Error("휴대전화 번호를 입력하세요.");
  if (linked && toE164(input) && toE164(input) !== linked) throw new Error("이미 인증된 번호와 다릅니다. 인증된 번호(" + linked.replace(/\d(?=\d{4})/g, "*") + ")로 인증해야 합니다.");
  try {
    verifier = new RecaptchaVerifier(auth, container, { size: "invisible" });
    confirmation = linked ? await reauthenticateWithPhoneNumber(auth.currentUser, phone, verifier) : await linkWithPhoneNumber(auth.currentUser, phone, verifier);
    pendingPhone = phone;
    return phone;
  } catch (e) { resetPhone(); throw new Error(friendly(e)); }
}
export async function confirmCode(code) {
  if (!confirmation) throw new Error("먼저 인증번호를 받으세요.");
  try {
    await confirmation.confirm(String(code || "").trim());
    await auth.currentUser?.getIdToken?.(true);   // 규칙이 보는 토큰에 전화번호를 싣는다
    verified = true;
    return auth.currentUser?.phoneNumber || pendingPhone;
  } catch (e) { throw new Error(friendly(e)); }
}
