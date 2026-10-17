const files = (globalThis.__mockFiles ||= {});
export function getStorage() { return {}; }
export function ref(st, path) { const parts = path.split("/"); return { fullPath: path, name: parts[parts.length - 1] }; }
export async function uploadBytes(r, file, meta) {
  if (globalThis.__uploadFail) { const e = new Error("fail"); e.code = "storage/unauthorized"; throw e; }
  files[r.fullPath] = { size: file.size, fname: file.name, meta: meta?.customMetadata || {} };
}
export async function listAll(r) {
  const prefix = r.fullPath.replace(/\/$/, "") + "/";
  const items = Object.keys(files).filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/")).map((p) => ref(null, p));
  (globalThis.__lists ||= []).push(r.fullPath);
  return { items, prefixes: [] };
}
export async function getMetadata(r) { return { customMetadata: files[r.fullPath]?.meta || {} }; }
export async function getDownloadURL(r) { if (!files[r.fullPath]) { const e = new Error("nf"); e.code = "storage/object-not-found"; throw e; } return "data:text/plain,mock-" + encodeURIComponent(r.fullPath); }
export async function deleteObject(r) { if (!files[r.fullPath]) { const e = new Error("nf"); e.code = "storage/object-not-found"; throw e; } delete files[r.fullPath]; }
