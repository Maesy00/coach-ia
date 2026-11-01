/*
 * sheet.js — feuille qui monte du bas de l'écran (formulaires, choix).
 * On la ferme avec la croix, en touchant le fond, ou en la tirant vers le bas.
 *
 * Sheet.open({ title, body: Element, footer: Element | null, onClose })
 */

const Sheet = (() => {
  let current = null;

  function close() {
    if (!current) return;
    const { sheet, backdrop, onClose } = current;
    current = null;
    sheet.classList.remove("in");
    sheet.style.transform = "";
    backdrop.classList.remove("in");
    setTimeout(() => {
      sheet.remove();
      backdrop.remove();
    }, 450);
    if (onClose) onClose();
  }

  function enableDragToClose(sheet, handles) {
    let startY = null;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;

    handles.forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        if (event.target.closest("button")) return;
        startY = event.clientY;
        lastY = startY;
        lastT = event.timeStamp;
        sheet.classList.add("dragging");
        handle.setPointerCapture(event.pointerId);
      });

      handle.addEventListener("pointermove", (event) => {
        if (startY === null) return;
        const dy = Math.max(0, event.clientY - startY);
        velocity = (event.clientY - lastY) / Math.max(1, event.timeStamp - lastT);
        lastY = event.clientY;
        lastT = event.timeStamp;
        sheet.style.transform = `translateY(${dy}px)`;
      });

      const end = (event) => {
        if (startY === null) return;
        const dy = Math.max(0, event.clientY - startY);
        startY = null;
        sheet.classList.remove("dragging");
        if (dy > sheet.offsetHeight * 0.3 || velocity > 0.6) close();
        else sheet.style.transform = "";
      };
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    });
  }

  function open({ title, body, footer = null, onClose = null }) {
    if (current) close();

    const backdrop = html(`<div class="sheet-backdrop"></div>`);
    const sheet = html(`
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}">
        <div class="sheet-grabber" aria-hidden="true"></div>
        <div class="sheet-header">
          <h2 class="sheet-title">${escapeHtml(title)}</h2>
          <button type="button" class="icon-btn" aria-label="Fermer">${icon("x")}</button>
        </div>
        <div class="sheet-body"></div>
      </div>
    `);
    sheet.querySelector(".sheet-body").appendChild(body);
    if (footer) {
      const wrap = html(`<div class="sheet-footer"></div>`);
      wrap.appendChild(footer);
      sheet.appendChild(wrap);
    } else {
      sheet.querySelector(".sheet-body").style.paddingBottom = "calc(var(--s-6) + var(--safe-bottom))";
    }

    sheet.querySelector(".sheet-header .icon-btn").addEventListener("click", close);
    backdrop.addEventListener("click", close);
    enableDragToClose(sheet, [sheet.querySelector(".sheet-grabber"), sheet.querySelector(".sheet-header")]);

    document.body.append(backdrop, sheet);
    current = { sheet, backdrop, onClose };
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        backdrop.classList.add("in");
        sheet.classList.add("in");
      })
    );
    return { close };
  }

  return { open, close, isOpen: () => current !== null };
})();
