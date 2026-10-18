// 대시보드 차트(지점별 인원, 상태 비율, 월별 입사)와 조직도. 외부 라이브러리 없이 HTML/CSS/SVG 로 그린다.
import { state, esc, orgTypeBadge, levelBadge } from "./core.js";
import { today, monthKey, addMonths } from "./dates.js";

const COLORS = { active: "#2F9E44", leave: "#E8590C", resigned: "#868E96" };
const NAMES = { active: "재직", leave: "휴직", resigned: "퇴직" };

export function renderCharts(el, emps, orgs, hr) {
  // 1) 지점별 재직 인원 (가로 막대) — 사람 수를 막대 끝에 숫자로 표시
  const rows = orgs.map((o) => ({ name: o.name, n: emps.filter((e) => e.status === "active" && e.orgIds.includes(o.id)).length })).filter((r) => r.n || hr);
  const max = Math.max(1, ...rows.map((r) => r.n));
  const bars = rows.map((r) => `<div class="bar-row"><span class="bar-name">${esc(r.name)}</span><span class="bar-track"><span class="bar-fill" style="width:${(r.n / max) * 100}%"></span></span><b class="bar-val">${r.n}</b></div>`).join("");
  // 2) 상태 비율 (도넛)
  const cnt = (s) => emps.filter((e) => e.status === s).length, total = emps.length || 1;
  let acc = 0; const stops = ["active", "leave", "resigned"].map((s) => { const a = acc, b = acc + (cnt(s) / total) * 100; acc = b; return `${COLORS[s]} ${a}% ${b}%`; });
  const donut = `<div class="donut" role="img" aria-label="재직 ${cnt("active")}명, 휴직 ${cnt("leave")}명, 퇴직 ${cnt("resigned")}명" style="background:conic-gradient(${emps.length ? stops.join(",") : "#E9ECEF 0 100%"})"><span>${emps.length}<small>명</small></span></div>
    <ul class="legend">${["active", "leave", "resigned"].map((s) => `<li><i style="background:${COLORS[s]}"></i>${NAMES[s]} <b>${cnt(s)}</b></li>`).join("")}</ul>`;
  // 3) 최근 12개월 입사 (세로 막대, SVG)
  const t = today(), months = []; for (let i = 11; i >= 0; i--) months.push(monthKey(addMonths(t.slice(0, 8) + "01", -i)));
  const byM = Object.fromEntries(months.map((m) => [m, 0])); emps.forEach((e) => { const m = (e.joinedAt || "").slice(0, 7); if (m in byM) byM[m]++; });
  const mm = Math.max(1, ...Object.values(byM)), W = 360, H = 120, bw = W / 12;
  const svg = `<svg viewBox="0 0 ${W} ${H + 22}" class="mchart" role="img" aria-label="최근 12개월 입사 인원">${months.map((m, i) => { const v = byM[m], h = Math.round((v / mm) * (H - 16)); return `<g><rect x="${i * bw + 5}" y="${H - h}" width="${bw - 10}" height="${h}" rx="3" fill="#F08C00"><title>${m} ${v}명</title></rect>${v ? `<text x="${i * bw + bw / 2}" y="${H - h - 4}" text-anchor="middle" font-size="10" fill="#495057">${v}</text>` : ""}<text x="${i * bw + bw / 2}" y="${H + 14}" text-anchor="middle" font-size="9.5" fill="#868E96">${Number(m.slice(5))}월</text></g>`; }).join("")}<line x1="0" y1="${H}" x2="${W}" y2="${H}" stroke="#DEE2E6"/></svg>`;
  el.innerHTML = `<div class="charts"><div class="card"><h2>지점별 재직 인원</h2>${bars || '<p class="sub">표시할 지점이 없습니다.</p>'}</div>
    <div class="card"><h2>재직 상태</h2><div class="donut-wrap">${donut}</div></div>
    <div class="card wide"><h2>월별 입사 (최근 12개월)</h2>${svg}</div></div>`;
}

export function renderOrgChart(el) {
  const emps = state.employees.filter((e) => e.status !== "resigned");
  const hq = state.orgs.filter((o) => o.type === "hq"), branches = state.orgs.filter((o) => o.type !== "hq");
  const card = (o) => {
    const members = emps.filter((e) => e.orgId === o.id || e.orgIds.includes(o.id));
    const rank = { principal: 0, admin: 1, manager: 2, hr: 3, edu: 3, super: 0, staff: 4 };
    members.sort((a, b) => (rank[a.level] ?? 9) - (rank[b.level] ?? 9) || a.name.localeCompare(b.name, "ko"));
    return `<div class="oc-node"><div class="oc-title">${esc(o.name)} ${orgTypeBadge(o.type)}<span class="sub">${members.length}명</span></div>
      <div class="oc-members">${members.map((m) => `<a class="oc-person" href="#emp/${esc(m.id)}" title="${esc(m.email || "")}"><span class="avatar">${esc((m.name || "?").slice(0, 1))}</span><span><b>${esc(m.name)}</b><small>${esc(m.position || "")} ${levelBadge(m.level)}</small></span></a>`).join("") || '<span class="sub">소속 직원이 없습니다</span>'}</div></div>`;
  };
  el.innerHTML = `<div class="oc">${hq.map(card).join("")}<div class="oc-line"></div><div class="oc-branches">${branches.map(card).join("")}</div></div>`;
}
