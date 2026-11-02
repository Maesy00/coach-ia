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

/* --- Dates : tout est manipulé en "AAAA-MM-JJ", en heure locale --- */

const DateUtil = (() => {
  const pad = (n) => String(n).padStart(2, "0");

  function toISO(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parse(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function addDays(iso, n) {
    const d = parse(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }

  // Lundi de la semaine de cette date.
  function weekStart(iso) {
    const d = parse(iso);
    return addDays(iso, -((d.getDay() + 6) % 7));
  }

  // Numéro de semaine ISO 8601.
  function weekNumber(iso) {
    const d = parse(iso);
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    return 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  }

  function daysBetween(a, b) {
    return Math.round((parse(b) - parse(a)) / 86400000);
  }

  return {
    toISO,
    parse,
    addDays,
    weekStart,
    weekNumber,
    daysBetween,
    today: () => toISO(new Date()),
    weekday: (iso) => (parse(iso).getDay() + 6) % 7, // 0 = lundi
    nowTime: () => {
      const d = new Date();
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },
  };
})();

/* --- Formats --- */

const Fmt = (() => {
  const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
  const weekdayShort = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
  const weekdayLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long" });
  const monthYear = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
  const monthShort = new Intl.DateTimeFormat("fr-FR", { month: "short" });
  const number = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const number2 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

  const toDate = (d) => (typeof d === "string" ? DateUtil.parse(d) : d);
  const clean = (s) => s.replace(".", "");

  // 95 → "1 h 35" ; 45 → "45 min"
  function duration(minutes) {
    const m = Math.round(minutes || 0);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${h} h`;
  }

  // Heures décimales pour les grands chiffres : 95 → "1,6"
  function hours(minutes) {
    return number.format((minutes || 0) / 60);
  }

  // La natation se compte en mètres, le reste en kilomètres.
  function distance(km, sport) {
    if (km === null || km === undefined || km === "") return "";
    if (sport === "swimming") return `${integer.format(km * 1000)} m`;
    return `${number2.format(km)} km`;
  }

  // Allure (course, natation) ou vitesse (vélo).
  function pace(km, minutes, sport) {
    if (!km || !minutes) return "";
    if (sport === "cycling") return `${number.format(km / (minutes / 60))} km/h`;
    const per = sport === "swimming" ? minutes / (km * 10) : minutes / km;
    const total = Math.round(per * 60);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")} ${sport === "swimming" ? "/100 m" : "/km"}`;
  }

  function clock(seconds) {
    const s = Math.max(0, Math.round(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
  }

  return {
    longDay: (date) => longDay.format(toDate(date)),
    shortDay: (date) => clean(shortDay.format(toDate(date))),
    weekdayShort: (date) => clean(weekdayShort.format(toDate(date))),
    weekdayLong: (date) => weekdayLong.format(toDate(date)),
    monthYear: (date) => monthYear.format(toDate(date)),
    monthShort: (date) => clean(monthShort.format(toDate(date))),
    number: (value) => number.format(value),
    integer: (value) => integer.format(value),
    duration,
    hours,
    distance,
    pace,
    clock,
  };
})();

/* --- Thème : clair (fond blanc) par défaut, sombre, ou celui de l'iPhone --- */

const Theme = (() => {
  const KEY = "coach.theme";
  const media = window.matchMedia("(prefers-color-scheme: light)");

  function get() {
    try {
      return localStorage.getItem(KEY) || "light";
    } catch {
      return "light";
    }
  }

  function apply() {
    const choice = get();
    const resolved = choice === "auto" ? (media.matches ? "light" : "dark") : choice;
    document.documentElement.dataset.theme = resolved;
    document.querySelector('meta[name="theme-color"]').content = resolved === "light" ? "#ffffff" : "#0a0a0b";
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

/* --- Barre du haut : le petit titre apparaît quand le grand titre sort de l'écran ---
 * Les onglets défilent avec la page (window) ; les pages empilées ont leur propre zone.
 */
const largeTitleWatchers = new Map();

function watchLargeTitle(container) {
  const previous = largeTitleWatchers.get(container);
  if (previous) previous.source.removeEventListener("scroll", previous.update);
  const bar = container.querySelector(".topbar");
  const title = container.querySelector(".large-title");
  if (!bar || !title) return;
  const isTab = container.classList.contains("screen");
  const source = isTab ? window : container;
  const update = () => {
    if (isTab && !container.classList.contains("active")) return;
    const y = isTab ? window.scrollY : container.scrollTop;
    const top = isTab ? title.getBoundingClientRect().top + window.scrollY : title.offsetTop;
    bar.classList.toggle("is-scrolled", y > top + title.offsetHeight - bar.offsetHeight);
  };
  source.addEventListener("scroll", update, { passive: true });
  largeTitleWatchers.set(container, { source, update });
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

/* --- Compteur − valeur + (charges, répétitions, durées) ---
 * La valeur est aussi modifiable au clavier. onChange(nombre) à chaque changement.
 */
function stepper({ label = "", value = 0, step = 1, min = 0, max = 9999, unit = "", size = "", onChange }) {
  const el = html(`
    <div class="stepper${size ? ` stepper-${size}` : ""}">
      ${label ? `<span class="stepper-label">${escapeHtml(label)}</span>` : ""}
      <div class="stepper-row">
        <button type="button" class="stepper-btn" data-delta="-1" aria-label="Moins">${icon("minus")}</button>
        <label class="stepper-value">
          <input type="text" inputmode="decimal" autocomplete="off" aria-label="${escapeHtml(label || "Valeur")}">
          ${unit ? `<span class="stepper-unit">${escapeHtml(unit)}</span>` : ""}
        </label>
        <button type="button" class="stepper-btn" data-delta="1" aria-label="Plus">${icon("plus")}</button>
      </div>
    </div>
  `);
  const input = el.querySelector("input");
  let current = Number(value) || 0;

  // Le champ prend la largeur de son contenu, pour que « 12 kg » reste centré.
  const show = () => {
    input.value = Fmt.number(current);
    input.style.width = `${Math.max(1, input.value.length) + 0.4}ch`;
  };
  const set = (next, notify = true) => {
    current = Math.min(max, Math.max(min, Math.round(next * 100) / 100));
    show();
    if (notify) onChange(current);
  };

  el.querySelectorAll("[data-delta]").forEach((btn) =>
    btn.addEventListener("click", () => {
      Haptic.tap();
      set(current + Number(btn.dataset.delta) * step);
    })
  );
  input.addEventListener("focus", () => input.select());
  input.addEventListener("input", () => (input.style.width = `${Math.max(1, input.value.length) + 0.4}ch`));
  input.addEventListener("change", () => {
    const parsed = Number(input.value.replace(",", ".").replace(/[^\d.]/g, ""));
    set(isNaN(parsed) ? current : parsed);
  });
  show();
  return { el, set: (v) => set(v, false), get: () => current };
}

/* --- Question oui/non dans une feuille --- */

function confirmSheet({ title, text, confirmLabel, danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const footer = html(`
      <div style="display:contents">
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" data-yes>${escapeHtml(confirmLabel)}</button>
        <button type="button" class="btn btn-ghost btn-block" data-no>Annuler</button>
      </div>
    `);
    const sheet = Sheet.open({
      title,
      body: html(`<p class="card-text" style="margin:0">${escapeHtml(text)}</p>`),
      footer,
      onClose: () => !answered && resolve(false),
    });
    footer.querySelector("[data-yes]").addEventListener("click", () => {
      answered = true;
      sheet.close();
      resolve(true);
    });
    footer.querySelector("[data-no]").addEventListener("click", () => sheet.close());
  });
}

/* --- Bip de fin de repos (Web Audio, pas de fichier son) --- */

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22].forEach((offset) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = 880;
      const t = ctx.currentTime + offset;
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      osc.start(t);
      osc.stop(t + 0.2);
    });
    setTimeout(() => ctx.close(), 800);
  } catch {
    // Contexte audio indisponible : la vibration suffit.
  }
}

/* --- Puces de choix (sport, intensité, période…) ---
 * options : [{ value, label, color?, icon? }] ; plusieurs choix si multiple.
 */
function choiceChips(options, value, onChange) {
  const el = html(`<div class="choice-chips"></div>`);
  options.forEach((o) => {
    const btn = html(`
      <button type="button" class="choice-chip" data-value="${escapeHtml(o.value)}" ${o.color ? `style="--sport:${escapeHtml(o.color)}"` : ""}>
        ${o.icon ? icon(o.icon) : o.color ? `<span class="chip-dot"></span>` : ""}${escapeHtml(o.label)}
      </button>
    `);
    btn.addEventListener("click", () => {
      Haptic.tap();
      select(o.value);
      onChange(o.value);
    });
    el.appendChild(btn);
  });
  function select(v) {
    el.querySelectorAll(".choice-chip").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === String(v))));
  }
  select(value);
  return el;
}
