/*
 * settings.js — Réglages (compte, apparence) et gestion des sports :
 * ajouter un sport (nom, pictogramme, couleur), modifier, masquer.
 * Les sports masqués sont archivés, jamais effacés.
 */

const Settings = (() => {
  // Bouton rond en haut à droite de chaque onglet.
  function button() {
    return `<button type="button" class="icon-btn" data-open-settings aria-label="Réglages">${icon("gear-six")}</button>`;
  }

  function bindButton(scope) {
    scope.querySelector("[data-open-settings]").addEventListener("click", open);
  }

  function open() {
    const current = document.querySelector(".screen.active");
    Page.push({ title: "Réglages", backLabel: current ? current.getAttribute("aria-label") : "Retour", render: renderSettings });
  }

  function renderSettings(content) {
    const theme = Theme.get();
    const count = Storage.getSports().length;

    content.innerHTML = `
      <h3 class="section-label">Compte</h3>
      <div class="list">
        <div class="row"><span class="row-title">Email</span><span class="row-value">${escapeHtml(Storage.getUserEmail())}</span></div>
        <button type="button" class="row row-danger" id="settings-signout"><span class="row-title">Se déconnecter</span></button>
      </div>
      <p class="section-note">Le même compte qu'Aurora, Ironly et Pause.</p>

      <h3 class="section-label">Apparence</h3>
      <div id="settings-theme"></div>

      <h3 class="section-label">Entraînement</h3>
      <div class="list has-tiles">
        <button type="button" class="row" id="settings-sports">
          <span class="sport-tile sm neutral">${icon("squares-four")}</span>
          <span class="row-main"><span class="row-title">Mes sports</span></span>
          <span class="row-value">${count}</span>${icon("caret-right", "regular", "row-chevron")}
        </button>
      </div>

      <h3 class="section-label">Données</h3>
      <div class="list has-tiles">
        <button type="button" class="row" id="settings-migrate">
          <span class="sport-tile sm neutral">${icon("arrow-square-in")}</span>
          <span class="row-main"><span class="row-title">Reprendre mes données</span><span class="row-sub">Aurora, Ironly et Pause</span></span>
          ${icon("caret-right", "regular", "row-chevron")}
        </button>
        <button type="button" class="row" id="settings-import">
          <span class="sport-tile sm neutral">${icon("file-arrow-up")}</span>
          <span class="row-main"><span class="row-title">Importer Garmin / Strava</span><span class="row-sub">.FIT, .GPX, .TCX, archive .zip</span></span>
          ${icon("caret-right", "regular", "row-chevron")}
        </button>
        <button type="button" class="row" id="settings-calendar">
          <span class="sport-tile sm neutral">${icon("calendar-dots")}</span>
          <span class="row-main"><span class="row-title">Apple Calendar</span><span class="row-sub">Abonnement à tes séances prévues</span></span>
          ${icon("caret-right", "regular", "row-chevron")}
        </button>
      </div>

      <h3 class="section-label">À propos</h3>
      <div class="list has-tiles">
        <button type="button" class="row" id="settings-design">
          <span class="sport-tile sm neutral">${icon("palette")}</span>
          <span class="row-main"><span class="row-title">Design system</span></span>
          ${icon("caret-right", "regular", "row-chevron")}
        </button>
      </div>
      <p class="section-note">Coach.ia · version 1.0</p>
    `;

    content.querySelector("#settings-theme").appendChild(
      segmented(
        [
          { value: "dark", label: "Sombre" },
          { value: "light", label: "Clair" },
          { value: "auto", label: "Auto" },
        ],
        theme,
        (value) => Theme.set(value)
      )
    );
    content.querySelector("#settings-sports").addEventListener("click", () => openSports("Réglages"));
    content.querySelector("#settings-design").addEventListener("click", () => DesignSystem.open());
    content.querySelector("#settings-migrate").addEventListener("click", () => Migration.open());
    content.querySelector("#settings-import").addEventListener("click", () => History.openImport());
    content.querySelector("#settings-calendar").addEventListener("click", () => Week.openCalendar());
    content.querySelector("#settings-signout").addEventListener("click", async () => {
      await supabaseClient.auth.signOut();
      Page.popAll();
    });
  }

  // ---- Mes sports ----

  function openSports(backLabel) {
    Page.push({ title: "Mes sports", backLabel, render: renderSports });
  }

  function sportRow(sport, archived) {
    return `
      <button type="button" class="row" data-sport="${sport.id}">
        ${sportTile(sport)}
        <span class="row-main">
          <span class="row-title">${escapeHtml(sport.name)}</span>
          ${sport.hasDistance ? `<span class="row-sub">Distance suivie</span>` : ""}
        </span>
        ${archived ? `<span class="tag tag-neutral">Réafficher</span>` : icon("caret-right", "regular", "row-chevron")}
      </button>
    `;
  }

  function renderSports(content, page) {
    const sports = Storage.getSports();
    const archived = Storage.getArchivedSports();

    content.innerHTML = `
      <div class="list has-tiles">
        ${sports.length ? sports.map((s) => sportRow(s, false)).join("") : `<p class="empty-list">Aucun sport affiché.</p>`}
      </div>
      <button type="button" class="btn btn-secondary btn-block" id="sports-add" style="margin-top:var(--s-4)">
        ${icon("plus")} Ajouter un sport
      </button>
      ${
        archived.length
          ? `<h3 class="section-label">Masqués</h3>
             <div class="list has-tiles">${archived.map((s) => sportRow(s, true)).join("")}</div>
             <p class="section-note">Un sport masqué garde tout son historique.</p>`
          : ""
      }
    `;

    content.querySelector("#sports-add").addEventListener("click", () => editSport(null, page));
    content.querySelectorAll("[data-sport]").forEach((row) =>
      row.addEventListener("click", async () => {
        const sport = Storage.getSport(row.dataset.sport);
        if (sport.archivedAt) {
          if (await Storage.setSportArchived(sport.id, false)) {
            Haptic.tap();
            showToast(`${sport.name} est de retour`);
            page.refresh();
          }
        } else {
          editSport(sport, page);
        }
      })
    );
  }

  function editSport(sport, page) {
    const draft = sport
      ? { name: sport.name, icon: sport.icon, color: sport.color, hasDistance: sport.hasDistance }
      : { name: "", icon: SPORT_ICONS[6], color: SPORT_COLORS[6], hasDistance: false };

    const body = html(`
      <div>
        <div class="sport-preview">
          <span class="preview-tile"></span>
          <div class="row-main">
            <p class="card-title preview-name"></p>
            <p class="card-text">Aperçu</p>
          </div>
        </div>
        <label class="field">
          <span class="field-label">Nom</span>
          <input class="input" type="text" maxlength="40" placeholder="Ex. Trail, Escalade…" autocomplete="off">
        </label>
        <span class="field-label">Pictogramme</span>
        <div class="picker-grid icon-grid">
          ${SPORT_ICONS.map((name) => `<button type="button" data-icon="${name}" aria-label="${name}">${icon(name)}</button>`).join("")}
        </div>
        <span class="field-label" style="margin-top:var(--s-6)">Couleur</span>
        <div class="picker-grid swatch-grid">
          ${SPORT_COLORS.map((c) => `<button type="button" data-color="${c}" style="--c:${c}" aria-label="Couleur ${c}"></button>`).join("")}
        </div>
        <div class="list" style="margin-top:var(--s-6)">
          <label class="row">
            <span class="row-main">
              <span class="row-title">Suivre la distance</span>
              <span class="row-sub">Pour les sports où l'on compte les kilomètres</span>
            </span>
            <input type="checkbox" class="switch">
          </label>
        </div>
      </div>
    `);

    const nameInput = body.querySelector(".input");
    const distance = body.querySelector(".switch");
    nameInput.value = draft.name;
    distance.checked = draft.hasDistance;

    function paint() {
      body.querySelector(".preview-tile").outerHTML = `<span class="preview-tile">${sportTile(draft, "lg")}</span>`;
      body.querySelector(".preview-name").textContent = draft.name.trim() || "Nouveau sport";
      body.querySelectorAll("[data-icon]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.icon === draft.icon)));
      body.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === draft.color)));
    }

    body.querySelectorAll("[data-icon]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.icon = b.dataset.icon;
        Haptic.tap();
        paint();
      })
    );
    body.querySelectorAll("[data-color]").forEach((b) =>
      b.addEventListener("click", () => {
        draft.color = b.dataset.color;
        Haptic.tap();
        paint();
      })
    );
    nameInput.addEventListener("input", () => {
      draft.name = nameInput.value;
      paint();
      save.disabled = !draft.name.trim();
    });
    distance.addEventListener("change", () => (draft.hasDistance = distance.checked));

    const footer = html(`
      <div style="display:contents">
        <button type="button" class="btn btn-primary btn-block">${sport ? "Enregistrer" : "Ajouter le sport"}</button>
        ${sport ? `<button type="button" class="btn btn-ghost btn-block" data-archive>Masquer ce sport</button>` : ""}
      </div>
    `);
    const save = footer.querySelector(".btn-primary");
    save.disabled = !draft.name.trim();

    save.addEventListener("click", async () => {
      save.disabled = true;
      const payload = { ...draft, name: draft.name.trim() };
      const ok = sport ? await Storage.updateSport(sport.id, payload) : await Storage.addSport(payload);
      if (!ok) {
        save.disabled = false;
        showToast("Enregistrement impossible, réessaie", "warning-circle");
        return;
      }
      Haptic.tap();
      sheet.close();
      showToast(sport ? "Sport modifié" : `${payload.name} ajouté`);
      page.refresh();
    });

    const archiveBtn = footer.querySelector("[data-archive]");
    if (archiveBtn) {
      archiveBtn.addEventListener("click", async () => {
        if (await Storage.setSportArchived(sport.id, true)) {
          sheet.close();
          showToast(`${sport.name} est masqué`, "eye-slash");
          page.refresh();
        }
      });
    }

    paint();
    const sheet = Sheet.open({ title: sport ? "Modifier le sport" : "Nouveau sport", body, footer });
  }

  return { button, bindButton, open, openSports };
})();
