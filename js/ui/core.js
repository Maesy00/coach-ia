/*
 * core.js — petites briques partagées par tous les écrans :
 * échappement HTML, création d'éléments, icônes Phosphor, retour
 * haptique, toast, formats de date et de nombre, thème.
 */

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function html(markup) {
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  return template.content.firstElementChild;
}

// Icônes Phosphor (police d'icônes) : icon("barbell"), icon("house", "fill").
function icon(name, weight = "regular", className = "") {
  const base = weight === "fill" ? "ph-fill" : "ph";
  return `<i class="${base} ph-${name}${className ? ` ${className}` : ""}" aria-hidden="true"></i>`;
}

/* --- Retour haptique ---
 * Safari sur iPhone n'a pas navigator.vibrate ; depuis iOS 18, basculer un
 * interrupteur natif (<input switch>) produit un petit « tic » : on s'en sert.
 */
const Haptic = (() => {
  let label = null;

  function tap() {
    if (navigator.vibrate) {
      navigator.vibrate(8);
      return;
    }
    if (!label) {
      label = document.createElement("label");
      label.setAttribute("aria-hidden", "true");
      label.style.display = "none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.setAttribute("switch", "");
      label.appendChild(input);
      document.body.appendChild(label);
    }
    label.click();
  }

  return { tap };
})();

/* --- Toast : court message en bas de l'écran --- */

let toastTimer = null;

function showToast(message, iconName = "check-circle") {
  const toast = document.getElementById("toast");
  toast.innerHTML = `${icon(iconName, "fill")}<span>${escapeHtml(message)}</span>`;
  toast.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add("visible")));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => (toast.hidden = true), 250);
  }, 2400);
}

/* --- Formats --- */

const Fmt = (() => {
  const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

  return {
    longDay: (date) => longDay.format(date),
    shortDay: (date) => shortDay.format(date),
    number: (value) => number.format(value),
  };
})();

/* --- Thème : sombre par défaut, clair, ou celui de l'iPhone --- */

const Theme = (() => {
  const KEY = "coach.theme";
  const media = window.matchMedia("(prefers-color-scheme: light)");

  function get() {
    try {
      return localStorage.getItem(KEY) || "dark";
    } catch {
      return "dark";
    }
  }

  function apply() {
    const choice = get();
    const resolved = choice === "auto" ? (media.matches ? "light" : "dark") : choice;
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]').content = resolved === "light" ? "#f7f7f5" : "#0a0a0b";
  }

  function set(choice) {
    try {
      localStorage.setItem(KEY, choice);
    } catch {
      // Navigation privée : le choix ne durera que le temps de la session.
    }
    apply();
  }

  media.addEventListener("change", apply);

  return { get, set, apply };
})();

/* --- Contrôle segmenté ---
 * options : [{ value, label }] ; onChange(value)
 */
function segmented(options, value, onChange) {
  const el = html(`
    <div class="segmented" role="group">
      <span class="seg-thumb" aria-hidden="true"></span>
      ${options
        .map((o) => `<button type="button" data-value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</button>`)
        .join("")}
    </div>
  `);
  const thumb = el.querySelector(".seg-thumb");
  const buttons = [...el.querySelectorAll("button")];

  function select(next, notify) {
    const index = Math.max(0, options.findIndex((o) => o.value === next));
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === index)));
    thumb.style.width = `calc((100% - 6px) / ${options.length})`;
    thumb.style.transform = `translateX(${index * 100}%)`;
    if (notify) onChange(options[index].value);
  }

  buttons.forEach((b) =>
    b.addEventListener("click", () => {
      Haptic.tap();
      select(b.dataset.value, true);
    })
  );
  select(value, false);
  return el;
}

/* --- Case de validation ronde, avec animation --- */

function checkButton(done, onToggle, label = "Valider") {
  const btn = html(`
    <button type="button" class="check${done ? " is-done" : ""}" aria-pressed="${done}" aria-label="${escapeHtml(label)}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
    </button>
  `);
  btn.addEventListener("click", () => {
    const next = !btn.classList.contains("is-done");
    btn.classList.toggle("is-done", next);
    btn.setAttribute("aria-pressed", String(next));
    btn.classList.remove("just-done");
    if (next) {
      void btn.offsetWidth; // relance l'animation
      btn.classList.add("just-done");
    }
    Haptic.tap();
    onToggle(next);
  });
  return btn;
}

/* --- Anneau de progression --- */

function ring(value, max, size = 64, stroke = 7) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return `
    <svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
      <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="ring-value" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="${stroke}"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - ratio)}" ${ratio === 0 ? 'stroke-opacity="0"' : ""}/>
    </svg>
  `;
}

/* --- Barre du haut : le petit titre apparaît quand le grand titre sort de l'écran --- */

function watchLargeTitle(scroller) {
  const bar = scroller.querySelector(".topbar");
  const title = scroller.querySelector(".large-title");
  if (!bar || !title) return;
  const update = () => bar.classList.toggle("is-scrolled", scroller.scrollTop > title.offsetTop + title.offsetHeight - bar.offsetHeight);
  scroller.addEventListener("scroll", update, { passive: true });
  update();
}

function topbar({ title, leading = "", trailing = "" }) {
  return `
    <header class="topbar">
      <div class="topbar-side">${leading}</div>
      <span class="topbar-title">${escapeHtml(title)}</span>
      <div class="topbar-side">${trailing}</div>
    </header>
  `;
}
