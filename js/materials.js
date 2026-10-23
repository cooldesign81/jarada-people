// 자라다 재료 관리 앱(별도 Firebase 프로젝트 jarada-materials)의 '재료 관리자' 지정.
// 재료 앱의 계정관리(vault) 접근은 그 프로젝트의 보안 규칙이 config/materialManagers 문서의 이메일 목록으로 판단한다.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

const matApp = initializeApp({
  apiKey: "AIzaSyCSPsm1kE336zBUaDX3A3D9NsIFSyoOJog",
  authDomain: "jarada-materials.firebaseapp.com",
  projectId: "jarada-materials",
  storageBucket: "jarada-materials.firebasestorage.app",
  messagingSenderId: "381345580244",
  appId: "1:381345580244:web:eb8f585b58392a92db6741",
}, "materials");
const matAuth = getAuth(matApp);
const matDb = getFirestore(matApp);
const REF = () => doc(matDb, "config", "materialManagers");

export const MAX_MANAGERS = 20;
export const normEmail = (s) => String(s || "").trim().toLowerCase();
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// 재료 프로젝트 쪽 로그인 상태(people 앱 로그인과는 따로 유지된다)
export function matUser() {
  return new Promise((res) => { let off, done = false; off = onAuthStateChanged(matAuth, (u) => { if (done) return; done = true; if (typeof off === "function") off(); res(u || null); }); });
}
export async function matSignIn() {
  const r = await signInWithPopup(matAuth, new GoogleAuthProvider());
  return r?.user || matAuth.currentUser;
}
export async function loadManagers() {
  const s = await getDoc(REF());
  const d = s.exists() ? s.data() : {};
  return { emails: Array.isArray(d.emails) ? d.emails.map(normEmail).filter(Boolean) : [], updatedBy: d.updatedBy || "" };
}
export async function saveManagers(emails, byEmail) {
  const list = [...new Set(emails.map(normEmail))].filter(validEmail).slice(0, MAX_MANAGERS);
  await setDoc(REF(), { emails: list, updatedBy: byEmail || "", updatedAt: serverTimestamp() });
  return list;
}
