/* 공통 상단 연결 (JP ONE shared/jp-header.js)
   app.js는 예전처럼 숨긴 #nav · #topWho · #appSub · #btnLogout 를 고치고,
   여기서 그 변화를 지켜보다가 공통 상단에 그대로 옮겨 그림 (app.js를 거의 안 건드리려는 방식) */
(function () {
  if (!window.JPHeader) return;   // 공통 상단 파일을 못 불러오면 예전 화면 그대로(숨긴 요소만 안 보임)
  const $ = id => document.getElementById(id);
  const hd = JPHeader.mount("#jpHeader", {
    app: "people",
    onTab: id => { location.hash = "#" + id; },
    onLogout: () => $("btnLogout").click()
  });
  function sync() {
    const nav = $("nav"), tabs = nav.classList.contains("hidden") ? [] : [...nav.querySelectorAll(".tab")].map(t => {
      const bd = t.querySelector(".tab-badge");
      return { id: t.dataset.view, label: (bd ? t.textContent.replace(bd.textContent, "") : t.textContent).trim(), badge: bd ? bd.textContent.trim() : "" };
    });
    const active = nav.querySelector(".tab.active")?.dataset.view;
    const who = $("topWho").textContent.trim(), loggedIn = !$("btnLogout").classList.contains("hidden");
    hd.update({ external: document.body.classList.contains("self-mode"), tabs, active, sub: $("appSub").textContent.trim(), user: who === "로그인 안 됨" ? "" : who, onLogout: loggedIn ? () => $("btnLogout").click() : null });
  }
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(sync, 0); };
  new MutationObserver(later).observe(document.querySelector("#nav").parentNode, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  sync();
})();
