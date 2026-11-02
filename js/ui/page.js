/*
 * page.js — pages qui glissent depuis la droite par-dessus les onglets
 * (Réglages, Sports…), comme la navigation d'iOS. Retour avec le bouton
 * ou en glissant depuis le bord gauche de l'écran.
 *
 * Page.push({ title, backLabel, render(container, page) })
 *   render reçoit la zone de contenu (sous le grand titre) ; il peut être
 *   rappelé via page.refresh() quand les données changent.
 */

const Page = (() => {
  const stack = [];

  function behindOf(index) {
    return index > 0 ? stack[index - 1].el : document.querySelector(".screens");
  }

  function pop() {
    const top = stack.pop();
    if (!top) return;
    top.el.classList.remove("in");
    top.el.style.transform = "";
    const behind = behindOf(stack.length);
    behind.classList.remove("behind");
    behind.style.transform = "";
    behind.style.filter = "";
    setTimeout(() => top.el.remove(), 450);
    if (stack.length) stack[stack.length - 1].refresh();
    else App.renderAll();
  }

  function enableEdgeSwipe(entry) {
    const el = entry.el;
    let startX = null;
    let startY = 0;
    let tracking = false;
    let behind = null;

    el.addEventListener(
      "touchstart",
      (event) => {
        const t = event.touches[0];
        if (t.clientX > 28) return;
        startX = t.clientX;
        startY = t.clientY;
        tracking = false;
      },
      { passive: true }
    );

    el.addEventListener(
      "touchmove",
      (event) => {
        if (startX === null) return;
        const t = event.touches[0];
        const dx = Math.max(0, t.clientX - startX);
        if (!tracking) {
          if (Math.abs(t.clientY - startY) > Math.abs(dx)) {
            startX = null;
            return;
          }
          tracking = true;
          behind = behindOf(stack.indexOf(entry));
          el.classList.add("dragging");
          behind.style.transition = "none";
        }
        const ratio = dx / el.offsetWidth;
        el.style.transform = `translateX(${dx}px)`;
        behind.style.transform = `translateX(${-24 * (1 - ratio)}%)`;
        behind.style.filter = `brightness(${0.6 + 0.4 * ratio})`;
      },
      { passive: true }
    );

    el.addEventListener("touchend", (event) => {
      if (startX === null || !tracking) {
        startX = null;
        return;
      }
      const dx = event.changedTouches[0].clientX - startX;
      startX = null;
      el.classList.remove("dragging");
      behind.style.transition = "";
      if (dx > el.offsetWidth * 0.35) {
        pop();
      } else {
        el.style.transform = "";
        behind.style.transform = "";
        behind.style.filter = "";
      }
    });
  }

  function push({ title, backLabel = "Retour", render }) {
    const el = html(`
      <div class="page" role="region" aria-label="${escapeHtml(title)}">
        <div class="screen-scroll">
          ${topbar({
            title,
            leading: `<button type="button" class="back-btn">${icon("caret-left")}<span>${escapeHtml(backLabel)}</span></button>`,
          })}
          <div class="hero"><h1 class="large-title">${escapeHtml(title)}</h1></div>
          <div class="page-content"></div>
        </div>
      </div>
    `);
    const content = el.querySelector(".page-content");
    const entry = { el, refresh: () => render(content, entry) };
    el.querySelector(".back-btn").addEventListener("click", pop);

    const behind = behindOf(stack.length);
    stack.push(entry);
    entry.refresh();
    document.body.appendChild(el);
    watchLargeTitle(el.querySelector(".screen-scroll"));
    enableEdgeSwipe(entry);

    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        el.classList.add("in");
        behind.classList.add("behind");
      })
    );
    return entry;
  }

  function popAll() {
    while (stack.length) pop();
  }

  return { push, pop, popAll, depth: () => stack.length };
})();
