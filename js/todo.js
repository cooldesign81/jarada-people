// 대시보드 ‘할 일·알림’: 이미 불러온 데이터(직원, 휴가)로만 계산한다 (추가 읽기 없음)
import { state, canApprove, isHR, isAdmin, esc } from "./core.js";
import { today, addDays, diffDays, parse, pad, fmtKo } from "./dates.js";
import { pendingCount } from "./leave.js";

export function buildTodos() {
  const out = [], t = today(), emps = state.employees.filter((e) => e.status !== "resigned");
  const names = (list, fmt) => list.map(fmt).join(", ");
  // 승인 대기 휴가
  const pend = pendingCount();
  if (pend) out.push({ lv: "warn", html: `승인을 기다리는 휴가가 <b>${pend}건</b> 있습니다.`, link: "#leaves", linkText: "처리하기" });
  // 오늘·이번 주 생일
  const bd = [];
  for (const e of emps) {
    if (!e.birthDate) continue;
    let md = e.birthDate.slice(5); const y = Number(t.slice(0, 4));
    for (const yy of [y, y + 1]) {
      let d = `${yy}-${md}`; if (md === "02-29" && new Date(yy, 1, 29).getMonth() !== 1) d = `${yy}-02-28`;
      const n = diffDays(t, d); if (n >= 0 && n <= 7) { bd.push({ e, n, d }); break; }
    }
  }
  bd.sort((a, b) => a.n - b.n);
  if (bd.length) out.push({ lv: "info", html: `생일: ${names(bd, (x) => `<b>${esc(x.e.name)}</b>${x.n === 0 ? " (오늘)" : ` (${x.d.slice(5).replace("-", "/")})`}`)}`, link: "#calendar", linkText: "달력 보기" });
  // 계약 만료·수습 종료 임박 (30일 이내, 이미 지난 지 7일 이내 포함)
  const near = (key, within) => emps.filter((e) => e[key]).map((e) => ({ e, n: diffDays(t, e[key]) })).filter((x) => x.n >= -7 && x.n <= within).sort((a, b) => a.n - b.n);
  const fmtD = (x) => `<b>${esc(x.e.name)}</b> <span class="sub">${x.n < 0 ? `${-x.n}일 지남` : x.n === 0 ? "오늘" : `D-${x.n}`}</span>`;
  const ce = near("contractEndDate", 30); if (ce.length) out.push({ lv: ce.some((x) => x.n < 0 || x.n <= 7) ? "bad" : "warn", html: `계약 만료 예정: ${names(ce, fmtD)}` });
  const pe = near("probationEndDate", 14); if (pe.length) out.push({ lv: "warn", html: `수습 종료 예정: ${names(pe, fmtD)}` });
  // 입사 1주년 도래 (이번 달) — 연차 15일 발생
  const ann = emps.filter((e) => e.joinedAt && diffDays(t, `${t.slice(0, 4)}-${e.joinedAt.slice(5)}`) >= 0 && diffDays(t, `${t.slice(0, 4)}-${e.joinedAt.slice(5)}`) <= 30 && Number(t.slice(0, 4)) - Number(e.joinedAt.slice(0, 4)) >= 1);
  if (ann.length && (isHR() || isAdmin())) out.push({ lv: "info", html: `근속 연차가 바뀌는 직원(30일 이내): ${names(ann, (e) => `<b>${esc(e.name)}</b> <span class="sub">${esc(e.joinedAt.slice(5).replace("-", "/"))}</span>`)}` });
  // 입사일 없음 (연차 계산 불가)
  if (isHR() || isAdmin()) { const no = emps.filter((e) => !e.joinedAt); if (no.length) out.push({ lv: "warn", html: `입사일이 없어 연차를 계산할 수 없는 직원 <b>${no.length}명</b>: ${names(no.slice(0, 5), (e) => esc(e.name))}${no.length > 5 ? " 외" : ""}` }); }
  if (isHR() || isAdmin()) out.push({ lv: "info", html: `서류·자격 현황은 관리 메뉴에서 확인하세요.`, link: "#admin", linkText: "현황 보기" });
  return out;
}
export function renderTodo(el) {
  const list = buildTodos();
  el.innerHTML = list.length ? `<div class="card"><h2>할 일·알림</h2><div class="todo-list">${list.map((i) => `<div class="todo ${i.lv}"><i></i><div>${i.html}${i.link ? ` <a href="${i.link}">${i.linkText}</a>` : ""}</div></div>`).join("")}</div></div>` : "";
}
