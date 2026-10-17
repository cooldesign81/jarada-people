const store = (globalThis.__mockStore ||= {});
const clone = (x) => JSON.parse(JSON.stringify(x));
const isPlain = (v) => v && typeof v === "object" && !Array.isArray(v);
const isDel = (v) => v && typeof v === "object" && v.__delete === true;
function deepMerge(t, s) { for (const k of Object.keys(s)) { if (isDel(s[k])) delete t[k]; else if (isPlain(s[k]) && isPlain(t[k]) && !isDel(s[k])) deepMerge(t[k], s[k]); else t[k] = clone(s[k]); } return t; }
export function deleteField() { return { __delete: true }; }
export const Timestamp = { fromDate: (d) => ({ seconds: Math.floor(d.getTime() / 1000), nanoseconds: 0 }), now: () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 }) };
export function orderBy(f, dir = "asc") { return { type: "orderBy", f, dir }; }
function log(...a) { (globalThis.__ops ||= []).push(a.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(" ")); }
export function getFirestore() { return {}; }
export function collection(db, ...segs) { return { type: "col", name: segs.join("/") }; }
export function doc(db, ...segs) { const path = segs.join("/"); return { type: "doc", col: segs.slice(0, -1).join("/"), id: segs[segs.length - 1], path }; }
export function where(f, op, v) { return { type: "where", f, op, v }; }
export function limit(n) { return { type: "limit", n }; }
export function query(src, ...cs) { return { type: "query", col: src.type === "col" ? src.name : src.col, cs: [...(src.cs || []), ...cs] }; }
export function serverTimestamp() { const ms = Date.now(); return { seconds: Math.floor(ms / 1000), nanoseconds: 0 }; }
function snap(col, id) { const d = store[col]?.[id]; return { id, ref: doc(null, ...col.split("/"), id), exists: () => d !== undefined, data: () => (d === undefined ? undefined : clone(d)) }; }
export async function getDoc(ref) { log("get", ref.path); (globalThis.__reads ||= []).push(ref.path); return snap(ref.col, ref.id); }
export async function getDocs(q) {
  const col = q.type === "col" ? q.name : q.col; const cs = q.cs || [];
  let docs = Object.keys(store[col] || {}).map((id) => snap(col, id));
  for (const c of cs) {
    if (c.type === "where") docs = docs.filter((s) => { const v = s.data()[c.f]; return c.op === "==" ? v === c.v : c.op === "array-contains" ? Array.isArray(v) && v.includes(c.v) : true; });
    if (c.type === "orderBy") { const val = (s) => { const v = s.data()[c.f]; return v && typeof v === "object" && "seconds" in v ? v.seconds : v; }; docs = docs.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * (c.dir === "desc" ? -1 : 1)); }
    if (c.type === "limit") docs = docs.slice(0, c.n);
  }
  log("list", col, JSON.stringify(cs));
  return { docs, empty: docs.length === 0, size: docs.length };
}
function checkRoleClaim(ref, data) {
  if (ref.col !== "roles" || !data.selfToken) return;
  const emp = store.employees?.[data.employeeId];
  if (!emp || !emp.selfToken || emp.selfToken !== data.selfToken || data.level !== "staff") { const e = new Error("denied"); e.code = "permission-denied"; throw e; }
}
export async function setDoc(ref, data, opts) {
  checkRoleClaim(ref, data);
  store[ref.col] ||= {};
  if (opts?.merge && store[ref.col][ref.id]) deepMerge(store[ref.col][ref.id], data);
  else store[ref.col][ref.id] = clone(data);
  log("set", ref.path, data);
}
export async function updateDoc(ref, data) {
  if (!store[ref.col]?.[ref.id]) { const e = new Error("No document to update: " + ref.path); e.code = "not-found"; throw e; }
  deepMergeTop(store[ref.col][ref.id], data); log("update", ref.path, data);
}
let autoId = 0;
export async function addDoc(colRef, data) { const id = "auto" + (++autoId); store[colRef.name] ||= {}; store[colRef.name][id] = clone(data); log("add", colRef.name + "/" + id, data); return { id, path: colRef.name + "/" + id }; }
function deepMergeTop(t, d) { for (const k of Object.keys(d)) { if (isDel(d[k])) delete t[k]; else t[k] = clone(d[k]); } }
export async function deleteDoc(ref) { if (store[ref.col]) delete store[ref.col][ref.id]; log("delete", ref.path); }
export function writeBatch() {
  const ops = [];
  return { set(ref, data, opts) { ops.push(() => setDoc(ref, data, opts)); }, async commit() { (globalThis.__batches ||= []).push(ops.length); for (const o of ops) await o(); } };
}
export async function runTransaction(db, fn) { const tx = { get: getDoc, set: (ref, data, opts) => { setDoc(ref, data, opts); } }; return fn(tx); }
