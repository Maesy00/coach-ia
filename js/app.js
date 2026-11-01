/*
 * app.js — navigation entre les 4 onglets et rafraîchissement de l'affichage.
 */

const App = (() => {
  const tabButtons = document.querySelectorAll(".tab");
  const screens = {
    today: { el: document.getElementById("screen-today"), view: () => Today },
    week: { el: document.getElementById("screen-week"), view: () => WeekScreen },
    strength: { el: document.getElementById("screen-strength"), view: () => StrengthScreen },
    history: { el: document.getElementById("screen-history"), view: () => HistoryScreen },
  };
  let currentTab = "today";
  let hiddenAt = null;

  function renderAll() {
    Object.values(screens).forEach((s) => {
      const scroll = s.el.scrollTop;
      s.view().render();
      s.el.scrollTop = scroll;
    });
  }

  function go(tab) {
    if (tab === currentTab) {
      screens[tab].el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    currentTab = tab;
    tabButtons.forEach((btn) => btn.setAttribute("aria-selected", String(btn.dataset.tab === tab)));
    Object.entries(screens).forEach(([id, s]) => s.el.classList.toggle("active", id === tab));
  }

  function start() {
    renderAll();
    currentTab = null;
    go("today");
  }

  tabButtons.forEach((btn) =>
    btn.addEventListener("click", () => {
      if (btn.dataset.tab !== currentTab) Haptic.tap();
      go(btn.dataset.tab);
    })
  );

  // Safari sur iPhone ignore parfois user-scalable=no : on bloque aussi le geste de pincement.
  ["gesturestart", "gesturechange"].forEach((type) =>
    document.addEventListener(type, (event) => event.preventDefault(), { passive: false })
  );

  // Revenir sur l'app après plus d'une minute : on recharge les données.
  document.addEventListener("visibilitychange", async () => {
    if (document.hidden) {
      hiddenAt = Date.now();
      return;
    }
    if (document.getElementById("app-shell").hidden || hiddenAt === null) return;
    const away = Date.now() - hiddenAt;
    hiddenAt = null;
    if (away < 60 * 1000) return;
    await Storage.refresh();
    renderAll();
  });

  return { start, go, renderAll };
})();
