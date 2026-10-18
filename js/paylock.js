// 급여 열람 비밀번호 창: 직원이 급여 명세서·세부내역서를 열 때마다 한 번 더 비밀번호를 묻는다.
// (로그아웃하지 않은 자리에서 다른 사람이 급여를 보는 것을 막기 위한 화면 잠금이다. 비밀번호 확인은 브라우저에서 하며,
//  서버가 강제하지는 못한다 — 로그아웃·화면 잠금과 함께 써야 한다.)
import { db } from "./firebase.js";
import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { $, state, toast, errMsg, audit } from "./core.js";
import { makeLock, verifyLock, checkNewPassword } from "./paylock-crypto.js";

const MAX_FAILS = 5, WAIT_MS = 60 * 1000;
const lockRef = (empId) => doc(db, "employees", empId, "private", "payLock");
const guard = { fails: 0, until: 0 };

export async function getPayLock(empId) {
  try { const s = await getDoc(lockRef(empId)); return s.exists() ? s.data() : null; }
  catch (e) { console.warn("비밀번호 정보 읽기 실패", e.code || e); throw e; }
}

// mode: "verify" (입력) | "set" (처음 설정) | "change" (변경). 확인되면 true, 취소하면 false
function ask(mode, empId, lock) {
  return new Promise((resolve) => {
    const dlg = $("dlgPayPw"), show = (id, on) => $(id).classList.toggle("hidden", !on);
    const titles = { verify: "급여 열람 비밀번호", set: "급여 열람 비밀번호 설정", change: "급여 열람 비밀번호 변경" };
    const descs = {
      verify: "급여 정보 보호를 위해 열 때마다 비밀번호를 한 번 더 확인합니다.",
      set: "급여 명세서를 볼 때마다 입력할 비밀번호를 정하세요. 로그인 비밀번호와는 별개이며 8자 이상(숫자만은 불가)입니다. 잊어버리면 담당자가 초기화해 드립니다.",
      change: "현재 비밀번호를 확인한 뒤 새 비밀번호를 정하세요.",
    };
    $("ppTitle").textContent = titles[mode]; $("ppDesc").textContent = descs[mode]; $("ppErr").textContent = "";
    show("ppOldWrap", mode === "verify" || mode === "change"); show("ppNewWrap", mode !== "verify"); show("ppNew2Wrap", mode !== "verify");
    $("ppOld").value = ""; $("ppNew").value = ""; $("ppNew2").value = "";
    $("ppOldLabel").textContent = mode === "change" ? "현재 비밀번호" : "비밀번호";
    $("btnPpOk").textContent = mode === "set" ? "설정하고 열기" : mode === "change" ? "변경" : "확인";
    let done = false;
    const finish = (v) => { if (done) return; done = true; $("btnPpOk").onclick = null; $("btnPpCancel").onclick = null; dlg.oncancel = null; $("ppOld").value = ""; $("ppNew").value = ""; $("ppNew2").value = ""; if (dlg.open) dlg.close(); resolve(v); };
    $("btnPpCancel").onclick = () => finish(false);
    dlg.oncancel = (e) => { e.preventDefault(); finish(false); };
    const submit = async () => {
      $("ppErr").textContent = "";
      const wait = guard.until - Date.now();
      if (wait > 0) return ($("ppErr").textContent = `비밀번호를 여러 번 틀렸습니다. ${Math.ceil(wait / 1000)}초 뒤에 다시 시도하세요.`);
      $("btnPpOk").disabled = true;
      try {
        if (mode === "verify" || mode === "change") {
          if (!(await verifyLock(lock, $("ppOld").value))) {
            if (++guard.fails >= MAX_FAILS) { guard.fails = 0; guard.until = Date.now() + WAIT_MS; audit("paylock_fail", { targetEmployeeId: empId, detail: `${MAX_FAILS}회 연속 틀림` }); $("ppErr").textContent = "비밀번호를 여러 번 틀려 1분간 막습니다."; }
            else $("ppErr").textContent = `비밀번호가 맞지 않습니다. (${MAX_FAILS - guard.fails}회 남음)`;
            $("ppOld").value = ""; $("ppOld").focus(); return;
          }
          guard.fails = 0;
        }
        if (mode !== "verify") {
          const msg = checkNewPassword($("ppNew").value, $("ppNew2").value);
          if (msg) return ($("ppErr").textContent = msg);
          await setDoc(lockRef(empId), { ...(await makeLock($("ppNew").value)), updatedAt: serverTimestamp() });
          audit(mode === "set" ? "paylock_set" : "paylock_change", { targetEmployeeId: empId });
          if (mode === "change") toast("비밀번호를 바꿨습니다");
        }
        finish(true);
      } catch (e) { console.error(e); $("ppErr").textContent = errMsg(e); }
      finally { $("btnPpOk").disabled = false; }
    };
    $("btnPpOk").onclick = submit;
    for (const id of ["ppOld", "ppNew", "ppNew2"]) $(id).onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };
    dlg.showModal(); ($(mode === "set" ? "ppNew" : "ppOld")).focus();
  });
}

// 급여를 열기 전에 호출. 비밀번호가 없으면 먼저 설정하게 한다. 통과하면 true
export async function requirePayPassword(empId = state.role?.employeeId) {
  let lock; try { lock = await getPayLock(empId); } catch (e) { toast("비밀번호 정보를 읽지 못했습니다: " + errMsg(e), true); return false; }
  return ask(lock ? "verify" : "set", empId, lock);
}
export async function changePayPassword(empId = state.role?.employeeId) {
  let lock; try { lock = await getPayLock(empId); } catch (e) { toast(errMsg(e), true); return false; }
  return ask(lock ? "change" : "set", empId, lock);
}
