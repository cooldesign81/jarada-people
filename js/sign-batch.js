// 관리 → ‘서명 문서’ : 제목·본문을 직접 쓴 서명 문서(취업규칙 확인, 교육 이수 확인 …)를 여러 직원에게 한 번에 보내고, 누가 서명했는지 본다.
// 각 직원의 문서는 employees/{사번}/contracts 에 ‘서명 대기(sent)’로 저장되고, 직원은 ‘내 서류’에서 확인·서명한다 (서명 화면은 contracts.js).
// 보낸 기록은 signBatches 에 남긴다 (현황 보기용).
import { db, auth } from "./firebase.js";
import { collection, getDocs, addDoc, query, where, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, isHR, esc, toast, errMsg, orgNames, audit, tsMillis } from "./core.js";
import { today } from "./dates.js";
import { CUSTOM_TEMPLATES, defaultsFor, cleanValues, missingRequired, FIELDS } from "./contract-docs.js";

const fmt = (t) => { const ms = tsMillis(t); if (!ms) return ""; const d = new Date(ms); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`; };
const STATUS = { draft: ["작성중", "s-leave"], sent: ["서명 대기", "o-hq"], signed: ["서명 완료", "s-active"] };

// 보낼 수 있는 직원: 재직 중이며, 대표이사 이상은 전체 · 원장은 자기 지점
const targets = () => state.employees.filter((e) => e.status === "active" && !e.deleted && (isHR() || (e.orgIds || [e.orgId]).includes(state.role?.orgId)));

export async function renderSignBatches(body) {
  const all = targets(), orgs = [...new Set(all.flatMap((e) => e.orgIds || [e.orgId]))];
  const tpl = CUSTOM_TEMPLATES;
  body.innerHTML = `<div class="card"><h2>서명 문서 보내기</h2>
    <p class="msg" style="margin:0 0 12px">제목과 본문을 쓰고 받는 직원을 고르면, 직원이 <b>내 서류</b>에서 내용을 확인하고 직접 서명합니다. (취업규칙 확인, 교육 이수 확인, 급여 명세서 수령 확인 등) 직원은 구글 계정으로 로그인해 있어야 서명할 수 있습니다.</p>
    <div class="grid-fields">
      <div class="field full"><label for="sbTpl">양식 불러오기</label><select id="sbTpl">${tpl.map((t) => `<option value="${t.key}">${esc(t.label)}</option>`).join("")}</select></div>
      <div class="field full"><label for="sbTitle">문서 제목<span class="req">*</span></label><input class="input" id="sbTitle" maxlength="100"></div>
      <div class="field full"><label for="sbBody">본문<span class="req">*</span> <span class="sub">({회사}는 회사명으로 바뀝니다)</span></label><textarea class="input" id="sbBody" rows="9" maxlength="5000"></textarea></div>
      <div class="field"><label for="sbMode">직원이 서명할 때 답하는 방식</label><select id="sbMode"><option value="confirm">‘확인하였으며 동의합니다’ 체크</option><option value="agree">동의함 / 동의하지 않음 선택</option></select></div>
      <div class="field"><label for="sbCo">회사명</label><input class="input" id="sbCo" maxlength="60" value="(주)제이드에듀"></div>
    </div>
    <h3 class="sec-title" style="margin-top:16px">받는 사람 <span class="sub" id="sbCount"></span></h3>
    <div class="row-actions" style="margin-bottom:8px">
      <select id="sbOrg"><option value="">전체 지점</option>${orgs.map((o) => `<option value="${esc(o)}">${esc(orgNames([o]))}</option>`).join("")}</select>
      <button class="btn btn-secondary btn-sm" id="sbAll" type="button">보이는 직원 모두 선택</button>
      <button class="btn btn-secondary btn-sm" id="sbNone" type="button">선택 해제</button>
    </div>
    <div class="chk-group" id="sbList" style="max-height:260px;overflow:auto"></div>
    <div class="msg error" id="sbErr"></div>
    <button class="btn btn-primary" id="sbSend" type="button" style="margin-top:10px">서명 요청 보내기</button>
  </div>
  <div class="card"><h2>보낸 서명 문서</h2><div id="sbHist"><p class="msg" style="margin:0">불러오는 중…</p></div><div id="sbStatus"></div></div>`;

  const picked = new Set();
  const drawList = () => {
    const org = $("sbOrg").value, rows = all.filter((e) => !org || (e.orgIds || [e.orgId]).includes(org));
    $("sbList").innerHTML = rows.length ? rows.map((e) => `<label class="check"><input type="checkbox" data-e="${esc(e.id)}" ${picked.has(e.id) ? "checked" : ""}> ${esc(e.name)} <span class="sub">${esc(orgNames(e.orgIds))}</span></label>`).join("") : `<p class="msg">보낼 수 있는 직원이 없습니다.</p>`;
    $("sbList").querySelectorAll("[data-e]").forEach((c) => (c.onchange = () => { c.checked ? picked.add(c.dataset.e) : picked.delete(c.dataset.e); count(); }));
    count();
  };
  const count = () => ($("sbCount").textContent = `(${picked.size}명 선택)`);
  $("sbOrg").onchange = drawList;
  $("sbAll").onclick = () => { const org = $("sbOrg").value; all.filter((e) => !org || (e.orgIds || [e.orgId]).includes(org)).forEach((e) => picked.add(e.id)); drawList(); };
  $("sbNone").onclick = () => { picked.clear(); drawList(); };
  $("sbTpl").onchange = () => { const t = tpl.find((x) => x.key === $("sbTpl").value); if (!t) return; $("sbTitle").value = t.title; $("sbBody").value = t.body; $("sbMode").value = t.mode; };
  drawList();
  $("sbSend").onclick = () => send(all, picked, body);
  loadHistory();
}

async function send(all, picked, body) {
  const err = (m) => ($("sbErr").textContent = m);
  err("");
  const raw = { title: $("sbTitle").value, body: $("sbBody").value, mode: $("sbMode").value, company: $("sbCo").value, name: "(받는 직원 이름)", signDate: today() };
  const vals = cleanValues("custom", raw);
  const miss = missingRequired("custom", vals);
  if (miss.length) return err(`${miss.join(", ")}을(를) 입력하세요.`);
  const to = all.filter((e) => picked.has(e.id));
  if (!to.length) return err("받는 직원을 한 명 이상 선택하세요.");
  if (!confirm(`‘${vals.title}’을(를) ${to.length}명에게 서명 요청으로 보낼까요?\n직원은 내 서류에서 확인하고 서명합니다.`)) return;
  $("sbSend").disabled = true;
  const me = { createdBy: auth.currentUser?.uid || "", createdByName: state.me?.name || auth.currentUser?.email || "" };
  let ok = 0; const fail = [];
  try {
    const batch = await addDoc(collection(db, "signBatches"), { title: vals.title, recipients: to.map((e) => e.id), count: to.length, createdAt: serverTimestamp(), ...me });
    for (const e of to) {
      try {
        const base = defaultsFor("custom", { emp: e, today: today() });
        const data = { ...vals, name: e.name, company: vals.company || base.company, signDate: today() };
        await addDoc(collection(db, "employees", e.id, "contracts"), { type: "custom", title: `${vals.title} · ${e.name}`, data, status: "sent", sentAt: serverTimestamp(), batchId: batch.id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...me });
        ok++;
      } catch (x) { console.error(x); fail.push(e.name); }
    }
    audit("contract_send", { detail: `일괄 발송 · ${vals.title} · ${ok}명${fail.length ? ` (실패 ${fail.length})` : ""}` });
    toast(fail.length ? `${ok}명에게 보냈습니다. 실패: ${fail.join(", ")}` : `${ok}명에게 서명 요청을 보냈습니다`, !!fail.length);
    picked.clear(); await renderSignBatches(body);
  } catch (x) { console.error(x); err(errMsg(x)); $("sbSend").disabled = false; }
}

let batches = [];
async function loadHistory() {
  const box = $("sbHist"); if (!box) return;
  try {
    const col = collection(db, "signBatches");
    batches = (await getDocs(isHR() ? col : query(col, where("createdBy", "==", auth.currentUser?.uid || "")))).docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn(e); box.innerHTML = `<p class="msg error" style="margin:0">${esc(errMsg(e))}</p>`; return; }
  batches.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
  box.innerHTML = batches.length ? `<div class="tbl-wrap"><table class="tbl rec-tbl"><thead><tr><th>제목</th><th>보낸 날</th><th>받는 사람</th><th></th></tr></thead><tbody>${batches.map((b) => `<tr><td>${esc(b.title)}</td><td class="sub">${esc(fmt(b.createdAt))}${b.createdByName ? " · " + esc(b.createdByName) : ""}</td><td>${b.count || (b.recipients || []).length}명</td><td><button class="btn btn-secondary btn-sm" data-st="${esc(b.id)}" type="button">서명 현황</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="msg" style="margin:0">아직 보낸 서명 문서가 없습니다.</p>`;
  box.querySelectorAll("[data-st]").forEach((b) => (b.onclick = () => showStatus(batches.find((x) => x.id === b.dataset.st))));
}

// 한 번 보낸 문서의 직원별 서명 상태 (직원 수만큼 읽는다)
async function showStatus(b) {
  const out = $("sbStatus"); if (!b || !out) return;
  out.innerHTML = `<p class="msg">서명 현황을 불러오는 중…</p>`;
  const rows = [];
  for (const id of b.recipients || []) {
    const emp = state.employees.find((e) => e.id === id);
    let d = null;
    try { d = (await getDocs(query(collection(db, "employees", id, "contracts"), where("batchId", "==", b.id)))).docs[0]?.data() || null; } catch (e) { console.warn(e); }
    rows.push({ id, name: emp?.name || id, st: d ? d.status || "draft" : "", at: d?.signedAt, ans: d?.answers });
  }
  const signed = rows.filter((r) => r.st === "signed").length;
  out.innerHTML = `<h3 class="sec-title" style="margin-top:16px">${esc(b.title)} — 서명 현황 <span class="sub">${signed} / ${rows.length}명 서명 완료</span></h3>
    <div class="tbl-wrap"><table class="tbl rec-tbl"><thead><tr><th>이름</th><th>상태</th><th>서명일</th><th>답</th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="#emp/${esc(r.id)}">${esc(r.name)}</a></td>
      <td>${r.st ? `<span class="badge ${STATUS[r.st][1]}">${STATUS[r.st][0]}</span>` : `<span class="badge off">문서 없음</span>`}</td><td class="sub">${esc(r.st === "signed" ? fmt(r.at) : "")}</td>
      <td class="sub">${esc(r.ans?.agree === "agree" ? "동의함" : r.ans?.agree === "disagree" ? "동의하지 않음" : r.ans?.confirm ? "확인·동의" : "")}</td></tr>`).join("")}</tbody></table></div>`;
}
