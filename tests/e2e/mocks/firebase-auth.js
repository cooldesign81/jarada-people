let currentUser = globalThis.__mockUser ?? null;
const listeners = [];
const emit = () => listeners.forEach((cb) => cb(currentUser));
globalThis.__auth = { get current() { return currentUser; } };
export function getAuth() { return { get currentUser() { return currentUser; } }; }
export class GoogleAuthProvider {}
export async function signInWithPopup() { currentUser = globalThis.__mockLoginUser || null; emit(); }
export async function signInAnonymously() { currentUser = { uid: "anon1", isAnonymous: true, email: null }; setTimeout(emit, 0); }
export async function signOut() { currentUser = null; emit(); }
export function onAuthStateChanged(auth, cb) { listeners.push(cb); setTimeout(() => cb(currentUser), 0); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; }
