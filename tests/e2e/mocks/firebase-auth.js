let currentUser = globalThis.__mockUser ?? null;
const listeners = [];
const emit = () => listeners.forEach((cb) => cb(currentUser));
globalThis.__auth = { get current() { return currentUser; } };
export function getAuth() { return { get currentUser() { return currentUser; } }; }
export class GoogleAuthProvider { static credential() { return {}; } }
export async function signInWithCredential() { const e = new Error("mock"); e.code = "auth/invalid-credential"; throw e; }
export async function signInWithPopup() { currentUser = globalThis.__mockLoginUser || null; emit(); }
export async function signInAnonymously() { currentUser = { uid: "anon1", isAnonymous: true, email: null }; setTimeout(emit, 0); }
export async function signOut() { currentUser = null; emit(); }
export function onAuthStateChanged(auth, cb) { listeners.push(cb); setTimeout(() => cb(currentUser), 0); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; }
// 문자 인증 (테스트용): 인증번호는 항상 123456
export class RecaptchaVerifier { constructor() {} clear() {} }
const phoneFlow = (phone) => { globalThis.__phoneSent = phone; return { confirm: async (code) => { if (code !== "123456") { const e = new Error("bad code"); e.code = "auth/invalid-verification-code"; throw e; } if (currentUser) { currentUser.phoneNumber = phone; currentUser.providerData = [...(currentUser.providerData || []), { providerId: "phone" }]; } } }; };
export async function linkWithPhoneNumber(user, phone) { if (globalThis.__phoneTaken === phone) { const e = new Error("taken"); e.code = "auth/credential-already-in-use"; throw e; } return phoneFlow(phone); }
export async function reauthenticateWithPhoneNumber(user, phone) { return phoneFlow(phone); }
