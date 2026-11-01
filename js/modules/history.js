/*
 * history.js — onglet Historique : toutes les activités (saisies, imports
 * Garmin/Strava, séances de muscu, séances cochées), filtrables par sport et
 * par période, avec volume, charge d'entraînement et records. Ajout manuel
 * et import de fichiers depuis le bouton « + ».
 */

const History = (() => {
  const screen = document.getElementById("screen-history");
  const PERIODS = [
    { value: "4w", label: "4 sem.", days: 28, bucket: "week", n: 4 },
    { value: "3m", label: "3 mois", days: 91, bucket: "week", n: 13 },
    { value: "1y", label: "1 an", days: 365, bucket: "month", n: 12 },
    { value: "all", label: "Tout", days: null, bucket: "month", n: null },
  ];
  const PAGE = 40;

  let sportFilter = null;
  let period = "3m";
  let shown = PAGE;

  // ---------------------------------------------------------------------
  // Onglet
  // ---------------------------------------------------------------------

  function periodRange() {
    const def = PERIODS.find((p) => p.value === period);
    const today = DateUtil.today();
    return { def, from: def.days ? DateUtil.addDays(today, -def.days + 1) : null, to: today };
  }

  function render() {
    const all = Storage.getActivities();
    const { def, from } = periodRange();
    const list = Stats.filter(all, { sport: sportFilter, from });
    const sport = sportFilter ? Storage.sportOrFallback(sportFilter) : null;
    const minutes = Stats.sum(list, (a) => a.durationMinutes);
    const km = Stats.sum(list, (a) => a.distanceKm);
    const showDistance = sport ? sport.hasDistance : km > 0;
    const load = Stats.trainingLoad(sportFilter ? Stats.filter(all, { sport: sportFilter }) : all);

    let buckets;
    if (def.bucket === "week") buckets = Stats.weekly(Stats.filter(all, { sport: sportFilter }), def.n);
    else {
      const oldest = list.length ? list[list.length - 1].date : DateUtil.today();
      const months = def.n || Math.min(60, Math.max(6, Math.ceil(DateUtil.daysBetween(oldest, DateUtil.today()) / 30.4) + 1));
      buckets = Stats.monthly(Stats.filter(all, { sport: sportFilter }), months);
    }
    const weeks = def.days ? def.days / 7 : Math.max(1, DateUtil.daysBetween(list.length ? list[list.length - 1].date : DateUtil.today(), DateUtil.today()) / 7);

    screen.innerHTML = `
      ${topbar({
        title: "Historique",
        trailing: `<button type="button" class="icon-btn" id="history-add" aria-label="Ajouter">${icon("plus")}</button>${Settings.button()}`,
      })}
      <div class="hero"><h1 class="large-title">Historique</h1></div>

      <div id="history-sports"></div>
      <div id="history-period" style="margin:var(--s-3) 0 var(--s-5)"></div>

      <div class="bento">
        <section class="card">
          <div class="card-label">${icon("timer")} Temps</div>
          <span class="metric">${Fmt.hours(minutes)}</span><span class="metric-unit">h</span>
          <p class="metric-sub">${Fmt.hours(minutes / weeks)} h / semaine</p>
        </section>
        <section class="card">
          <div class="card-label">${showDistance ? `${icon("path")} Distance` : `${icon("hash")} Séances`}</div>
          ${
            showDistance
              ? `<span class="metric">${sportFilter === "swimming" ? Fmt.integer(km * 1000) : Fmt.integer(km)}</span><span class="metric-unit">${sportFilter === "swimming" ? "m" : "km"}</span><p class="metric-sub">${list.length} séance${list.length > 1 ? "s" : ""}</p>`
              : `<span class="metric">${list.length}</span><p class="metric-sub">${Fmt.number(list.length / weeks)} / semaine</p>`
          }
        </section>
        <section class="card span-2" id="history-volume">
          <div class="card-label">${icon("chart-bar")} Volume ${def.bucket === "week" ? "par semaine" : "par mois"}</div>
        </section>
        <section class="card span-2">
          <div class="card-label">${icon("heartbeat")} Charge d'entraînement${load.estimated ? `<span class="card-action tag tag-neutral">en partie estimée</span>` : ""}</div>
          <div class="load-row">
            <div><span class="metric">${load.ratio !== null ? Fmt.number(Math.round(load.ratio * 100) / 100) : "—"}</span><p class="metric-sub">${escapeHtml(load.status)}</p></div>
            <div class="load-meter" aria-hidden="true"><span class="load-zone"></span><span class="load-cursor" style="left:${load.ratio !== null ? Math.min(100, (load.ratio / 2) * 100) : 50}%"></span></div>
          </div>
          <p class="card-text num">7 derniers jours : ${Fmt.integer(load.acute)} · moyenne sur 4 semaines : ${Fmt.integer(load.chronic)} (sRPE)</p>
        </section>
        ${sport ? recordsCard(all, sport) : ""}
      </div>

      <h3 class="section-label">Activités</h3>
      <div id="history-list"></div>
    `;

    const sports = Storage.getSports();
    const chips = choiceChips(
      [{ value: "", label: "Tous" }, ...sports.map((s) => ({ value: s.slug, label: s.name, color: s.color, icon: s.icon }))],
      sportFilter || "",
      (v) => {
        sportFilter = v || null;
        shown = PAGE;
        render();
      }
    );
    chips.classList.add("scroll");
    screen.querySelector("#history-sports").appendChild(chips);
    screen.querySelector("#history-period").appendChild(
      segmented(PERIODS, period, (v) => {
        period = v;
        shown = PAGE;
        render();
      })
    );
    screen.querySelector("#history-volume").appendChild(
      Chart.bars(
        buckets.map((b) => ({ label: def.bucket === "week" ? `${b.label} · ${Fmt.shortDay(b.start)}` : Fmt.monthYear(b.start), value: Math.round((b.minutes / 60) * 10) / 10 })),
        { unit: "h" }
      )
    );
    renderList(list);
    screen.querySelector("#history-add").addEventListener("click", openAddMenu);
    screen.querySelectorAll("[data-record]").forEach((row) => row.addEventListener("click", () => openActivity(Storage.getActivity(row.dataset.record))));

    Settings.bindButton(screen);
    watchLargeTitle(screen);
  }

  function recordsCard(all, sport) {
    if (sport.slug === "strength") {
      return `<section class="card span-2"><div class="card-label">${icon("trophy")} Records</div><p class="card-text" style="margin:0">Les records de musculation sont dans l'onglet Muscu, exercice par exercice.</p></section>`;
    }
    const records = Stats.records(all, sport.slug);
    if (!records.length) return "";
    return `
      <section class="card span-2 records-card">
        <div class="card-label">${icon("trophy")} Records · ${escapeHtml(sport.name)}</div>
        <div class="list list-flat">
          ${records
            .map(
              (r) => `<button type="button" class="row" data-record="${r.activity.id}">
                <span class="row-main"><span class="row-title">${escapeHtml(r.value)}</span><span class="row-sub">${escapeHtml(r.label)} · ${escapeHtml(Fmt.shortDay(r.activity.date))} ${DateUtil.parse(r.activity.date).getFullYear()}</span></span>
                ${icon("caret-right", "regular", "row-chevron")}
              </button>`
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderList(list) {
    const box = screen.querySelector("#history-list");
    if (!list.length) {
      box.innerHTML = `<div class="card empty-list">Aucune activité sur cette période. Ajoute-en une avec « + » ou importe tes fichiers Garmin et Strava.</div>`;
      return;
    }
    const visible = list.slice(0, shown);
    const groups = [];
    visible.forEach((a) => {
      const key = a.date.slice(0, 7);
      if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
      groups[groups.length - 1].items.push(a);
    });
    box.innerHTML = `
      ${groups
        .map(
          (g) => `
          <p class="month-label">${escapeHtml(Fmt.monthYear(`${g.key}-01`))}</p>
          <div class="list has-tiles">${g.items.map(activityRow).join("")}</div>`
        )
        .join("")}
      ${list.length > shown ? `<button type="button" class="btn btn-ghost btn-block" id="history-more" style="margin-top:var(--s-3)">Afficher plus (${list.length - shown} restantes)</button>` : ""}
    `;
    box.querySelectorAll("[data-activity]").forEach((row) => row.addEventListener("click", () => openActivity(Storage.getActivity(row.dataset.activity))));
    const more = box.querySelector("#history-more");
    if (more) more.addEventListener("click", () => {
      shown += PAGE * 2;
      renderList(list);
    });
  }

  function activityRow(a) {
    const sport = Storage.sportOrFallback(a.sport);
    const meta = [Fmt.duration(a.durationMinutes), Fmt.distance(a.distanceKm, a.sport), Fmt.pace(a.distanceKm, a.durationMinutes, a.sport)].filter(Boolean).join(" · ");
    return `
      <button type="button" class="row" data-activity="${a.id}">
        ${sportTile(sport)}
        <span class="row-main">
          <span class="row-title">${escapeHtml(a.title || sport.name)}</span>
          <span class="row-sub num">${escapeHtml(meta)}</span>
        </span>
        <span class="row-value">${escapeHtml(Fmt.weekdayShort(a.date))} ${escapeHtml(Fmt.shortDay(a.date).split(" ")[0])}</span>
      </button>
    `;
  }

  // ---------------------------------------------------------------------
  // Détail d'une activité
  // ---------------------------------------------------------------------

  function openActivity(activity) {
    if (!activity) return;
    const sport = Storage.sportOrFallback(activity.sport);
    const rpe = Stats.rpeOf(activity);
    const metrics = [
      { label: "Durée", value: Fmt.duration(activity.durationMinutes) },
      activity.distanceKm ? { label: "Distance", value: Fmt.distance(activity.distanceKm, activity.sport) } : null,
      activity.distanceKm ? { label: activity.sport === "cycling" ? "Vitesse" : "Allure", value: Fmt.pace(activity.distanceKm, activity.durationMinutes, activity.sport) } : null,
      activity.elevationM ? { label: "Dénivelé", value: `${Fmt.integer(activity.elevationM)} m` } : null,
      activity.avgHr ? { label: "FC moyenne", value: `${activity.avgHr} bpm` } : null,
      activity.maxHr ? { label: "FC max", value: `${activity.maxHr} bpm` } : null,
      { label: "RPE", value: activity.rpe ? `${activity.rpe}/10` : "—" },
      { label: "Charge", value: `${Fmt.integer(Stats.loadOf(activity))}${rpe.estimated ? " (est.)" : ""}` },
    ].filter(Boolean);
    const strength = activity.details && Array.isArray(activity.details.exercises) ? activity.details.exercises : null;

    const body = html(`
      <div>
        <div class="sport-preview">
          ${sportTile(sport, "lg")}
          <div class="row-main">
            <p class="card-title">${escapeHtml(activity.title || sport.name)}</p>
            <p class="card-text">${escapeHtml(Fmt.longDay(activity.date))}${activity.startTime ? ` · ${escapeHtml(activity.startTime)}` : ""}</p>
          </div>
        </div>
        <div class="metric-grid">
          ${metrics.map((m) => `<div><p class="metric-grid-label">${escapeHtml(m.label)}</p><p class="metric-grid-value num">${escapeHtml(m.value)}</p></div>`).join("")}
        </div>
        ${
          strength
            ? `<h3 class="section-label">Exercices</h3><div class="list">${strength
                .map((e) => {
                  const ex = Exercises.byId(e.exerciseId);
                  return `<div class="row"><span class="row-main"><span class="row-title">${escapeHtml(ex.name)}</span><span class="row-sub num">${escapeHtml(Strength.formatSets(e.sets, ex.metric))}</span></span></div>`;
                })
                .join("")}</div>`
            : ""
        }
        ${activity.notes ? `<h3 class="section-label">Notes</h3><p class="card-text" style="white-space:pre-wrap;margin:0">${escapeHtml(activity.notes)}</p>` : ""}
        <p class="section-note">Source : ${escapeHtml(Dedupe.sourceLabel(activity.source))}</p>
      </div>
    `);
    const footer = html(`
      <div style="display:contents">
        <button type="button" class="btn btn-secondary btn-block" data-edit>${icon("pencil-simple")} Modifier</button>
        <button type="button" class="btn btn-ghost btn-block" data-delete>Supprimer</button>
      </div>
    `);
    footer.querySelector("[data-edit]").addEventListener("click", () => {
      sheet.close();
      setTimeout(() => editActivity(activity), 320);
    });
    footer.querySelector("[data-delete]").addEventListener("click", async () => {
      const ok = await confirmSheet({
        title: "Supprimer cette activité ?",
        text: "Elle disparaît de l'historique et des statistiques (elle reste archivée dans la base).",
        confirmLabel: "Supprimer",
        danger: true,
      });
      if (!ok) return;
      const linked = Storage.getPlanned().find((p) => p.activityId === activity.id);
      if (linked) await Storage.update("planned", linked.id, { activityId: null, doneAt: null });
      if (await Storage.setArchived("activities", activity.id, true)) {
        showToast("Activité supprimée", "trash");
        App.renderAll();
      }
    });
    const sheet = Sheet.open({ title: sport.name, body, footer });
  }

  // ---------------------------------------------------------------------
  // Saisie / modification
  // ---------------------------------------------------------------------

  function editActivity(activity) {
    const sports = Storage.getSports();
    const draft = activity
      ? { ...activity }
      : { sport: (sports[0] || {}).slug || "running", date: DateUtil.today(), startTime: "", durationMinutes: 45, distanceKm: null, elevationM: null, rpe: null, notes: "", title: "" };

    const body = html(`
      <div>
        <span class="field-label">Sport</span>
        <div data-sports></div>
        <div class="field-row" style="margin-top:var(--s-5)">
          <label class="field"><span class="field-label">Date</span><input class="input" type="date" data-field="date" required></label>
          <label class="field"><span class="field-label">Heure (facultatif)</span><input class="input" type="time" data-field="startTime"></label>
        </div>
        <span class="field-label">Durée</span>
        <div class="field-row">
          <div data-hours></div>
          <div data-minutes></div>
        </div>
        <div data-distance></div>
        <span class="field-label">Ressenti (RPE)</span>
        <div class="rpe-grid" data-rpe>${Array.from({ length: 10 }, (_, i) => `<button type="button" class="rpe-btn num" data-value="${i + 1}">${i + 1}</button>`).join("")}</div>
        <p class="section-note" style="margin-bottom:var(--s-5)">1 très facile · 5 modéré · 10 maximal. Sert à calculer la charge.</p>
        <label class="field"><span class="field-label">Titre (facultatif)</span><input class="input" type="text" maxlength="80" data-field="title"></label>
        <label class="field"><span class="field-label">Notes</span><textarea class="input" rows="2" data-field="notes"></textarea></label>
      </div>
    `);

    const sportChips = choiceChips(
      sports.map((s) => ({ value: s.slug, label: s.name, color: s.color, icon: s.icon })),
      draft.sport,
      (v) => {
        draft.sport = v;
        paintDistance();
      }
    );
    sportChips.classList.add("scroll");
    body.querySelector("[data-sports]").appendChild(sportChips);
    body.querySelectorAll("[data-field]").forEach((input) => {
      input.value = draft[input.dataset.field] || "";
      input.addEventListener("input", () => (draft[input.dataset.field] = input.value));
    });
    body.querySelector("[data-hours]").appendChild(
      stepper({ label: "Heures", value: Math.floor(draft.durationMinutes / 60), max: 24, onChange: (v) => (draft.durationMinutes = v * 60 + (draft.durationMinutes % 60)) }).el
    );
    body.querySelector("[data-minutes]").appendChild(
      stepper({ label: "Minutes", value: Math.round(draft.durationMinutes % 60), max: 59, onChange: (v) => (draft.durationMinutes = Math.floor(draft.durationMinutes / 60) * 60 + v) }).el
    );

    function paintDistance() {
      const box = body.querySelector("[data-distance]");
      const sport = Storage.sportOrFallback(draft.sport);
      box.innerHTML = "";
      if (!sport.hasDistance) return;
      const swim = draft.sport === "swimming";
      const row = html(`<div class="field-row"><div></div><div></div></div>`);
      row.children[0].appendChild(
        stepper({
          label: swim ? "Distance" : "Distance",
          value: draft.distanceKm ? (swim ? draft.distanceKm * 1000 : draft.distanceKm) : 0,
          step: swim ? 25 : 0.5,
          max: swim ? 20000 : 1000,
          unit: swim ? "m" : "km",
          onChange: (v) => (draft.distanceKm = v ? (swim ? v / 1000 : v) : null),
        }).el
      );
      row.children[1].appendChild(stepper({ label: "Dénivelé", value: draft.elevationM || 0, step: 10, max: 10000, unit: "m", onChange: (v) => (draft.elevationM = v || null) }).el);
      box.appendChild(row);
    }
    paintDistance();

    const rpeButtons = body.querySelectorAll("[data-rpe] button");
    const paintRpe = () => rpeButtons.forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.value) === draft.rpe)));
    rpeButtons.forEach((b) =>
      b.addEventListener("click", () => {
        draft.rpe = draft.rpe === Number(b.dataset.value) ? null : Number(b.dataset.value);
        Haptic.tap();
        paintRpe();
      })
    );
    paintRpe();

    const footer = html(`<button type="button" class="btn btn-primary btn-block">${activity ? "Enregistrer" : "Ajouter l'activité"}</button>`);
    footer.addEventListener("click", async () => {
      if (!draft.date) return showToast("Indique la date", "warning-circle");
      if (!draft.durationMinutes) return showToast("Indique la durée", "warning-circle");
      footer.disabled = true;
      const sport = Storage.sportOrFallback(draft.sport);
      const payload = {
        sport: draft.sport,
        date: draft.date,
        startTime: draft.startTime || null,
        durationMinutes: draft.durationMinutes,
        distanceKm: sport.hasDistance ? draft.distanceKm : null,
        elevationM: sport.hasDistance ? draft.elevationM : null,
        rpe: draft.rpe,
        title: (draft.title || "").trim() || null,
        notes: (draft.notes || "").trim(),
      };
      const saved = activity ? await Storage.update("activities", activity.id, payload) : await Storage.insert("activities", { ...payload, source: "manual" });
      if (!saved) {
        footer.disabled = false;
        return showToast("Enregistrement impossible, réessaie", "warning-circle");
      }
      Haptic.tap();
      sheet.close();
      showToast(activity ? "Activité modifiée" : "Activité ajoutée");
      App.renderAll();
    });
    const sheet = Sheet.open({ title: activity ? "Modifier l'activité" : "Nouvelle activité", body, footer });
  }

  // ---------------------------------------------------------------------
  // Import de fichiers
  // ---------------------------------------------------------------------

  function openAddMenu() {
    const body = html(`
      <div class="list">
        <button type="button" class="row" data-manual>${icon("pencil-simple-line")}<span class="row-main"><span class="row-title">Saisir une activité</span><span class="row-sub">Sport, date, durée, distance, ressenti</span></span></button>
        <button type="button" class="row" data-import>${icon("file-arrow-up")}<span class="row-main"><span class="row-title">Importer des fichiers</span><span class="row-sub">.FIT, .GPX, .TCX ou archive Strava (.zip)</span></span></button>
      </div>
    `);
    body.querySelector("[data-manual]").addEventListener("click", () => {
      sheet.close();
      setTimeout(() => editActivity(null), 320);
    });
    body.querySelector("[data-import]").addEventListener("click", () => {
      sheet.close();
      openImport();
    });
    const sheet = Sheet.open({ title: "Ajouter", body });
  }

  function openImport() {
    let results = null;

    Page.push({
      title: "Importer",
      backLabel: "Historique",
      render(content, page) {
        if (!results) {
          content.innerHTML = `
            <label class="drop-zone">
              <input type="file" multiple accept=".fit,.gpx,.tcx,.zip,.gz,.csv" hidden>
              ${sportTile({ color: "var(--accent-ink)", icon: "file-arrow-up" }, "lg")}
              <span class="card-title">Choisir des fichiers</span>
              <span class="card-text">.FIT (Garmin), .GPX, .TCX, ou l'archive .zip d'export Strava</span>
            </label>
            <p class="import-status" hidden></p>
            <h3 class="section-label">Bon à savoir</h3>
            <div class="list">
              <div class="row">${icon("copy")}<span class="row-main"><span class="row-title">Pas de doublons</span><span class="row-sub">Une activité déjà présente (Garmin, Strava, Aurora, ou cochée dans la Semaine) est reconnue et ignorée.</span></span></div>
              <div class="row">${icon("desktop")}<span class="row-main"><span class="row-title">Archive Strava : depuis le Mac</span><span class="row-sub">Strava → Paramètres → Mon compte → Télécharger ou supprimer votre compte. L'archive peut peser plusieurs Go.</span></span></div>
              <div class="row">${icon("lock-simple")}<span class="row-main"><span class="row-title">Tout reste sur ton appareil</span><span class="row-sub">Les fichiers sont lus dans le navigateur ; seuls les résumés sont enregistrés.</span></span></div>
            </div>
          `;
          const input = content.querySelector("input");
          const status = content.querySelector(".import-status");
          input.addEventListener("change", async () => {
            if (!input.files.length) return;
            status.hidden = false;
            content.querySelector(".drop-zone").classList.add("busy");
            const { candidates, errors } = await Importers.readFiles(input.files, (label) => (status.textContent = `${label}…`));
            results = { items: Dedupe.classify(candidates, Storage.getActivities()), errors };
            page.refresh();
          });
          return;
        }

        const by = (status) => results.items.filter((i) => i.status === status);
        const fresh = [...by("new"), ...by("replace")].sort((a, b) => (a.date < b.date ? 1 : -1));
        const dupes = by("duplicate");
        const unknown = by("unknown");
        const unknownTypes = [...new Set(unknown.map((u) => u.rawType || "?"))];

        content.innerHTML = `
          <div class="bento">
            <section class="card"><div class="card-label">${icon("plus-circle")} Nouvelles</div><span class="metric">${fresh.length}</span></section>
            <section class="card"><div class="card-label">${icon("copy")} Déjà là</div><span class="metric">${dupes.length}</span></section>
          </div>
          ${unknown.length ? `<p class="section-note">${unknown.length} activité${unknown.length > 1 ? "s" : ""} d'un sport non suivi (${escapeHtml(unknownTypes.slice(0, 5).join(", "))}) : ajoute ce sport dans Réglages → Mes sports pour l'importer.</p>` : ""}
          ${results.errors.length ? `<p class="section-note">Fichiers illisibles : ${escapeHtml(results.errors.map((e) => `${e.fileName} (${e.message})`).join(", "))}</p>` : ""}
          ${
            fresh.length
              ? `<button type="button" class="btn btn-primary btn-block btn-lg" id="import-go" style="margin-top:var(--s-5)">Importer ${fresh.length} activité${fresh.length > 1 ? "s" : ""}</button>`
              : `<p class="card-text" style="margin-top:var(--s-5)">Rien de nouveau à importer.</p>`
          }
          ${fresh.length ? `<h3 class="section-label">À importer</h3><div class="list has-tiles">${fresh.slice(0, 60).map(previewRow).join("")}</div>${fresh.length > 60 ? `<p class="section-note">… et ${fresh.length - 60} autres.</p>` : ""}` : ""}
          ${dupes.length ? `<h3 class="section-label">Ignorées (déjà présentes)</h3><div class="list has-tiles">${dupes.slice(0, 30).map(previewRow).join("")}</div>` : ""}
          <button type="button" class="btn btn-ghost btn-block" id="import-again" style="margin-top:var(--s-4)">Choisir d'autres fichiers</button>
        `;
        content.querySelector("#import-again").addEventListener("click", () => {
          results = null;
          page.refresh();
        });
        const go = content.querySelector("#import-go");
        if (go) go.addEventListener("click", async () => {
          go.disabled = true;
          go.textContent = "Import en cours…";
          try {
            const toRow = (c) => ({
              sport: c.sport, date: c.date, startTime: c.startTime, durationMinutes: c.durationMinutes, distanceKm: c.distanceKm,
              elevationM: c.elevationM, avgHr: c.avgHr, maxHr: c.maxHr, title: c.title, source: c.source, externalId: c.externalId,
            });
            const created = await Storage.insertMany("activities", by("new").map((c) => ({ ...toRow(c), notes: "" })));
            for (const r of by("replace")) {
              await Storage.update("activities", r.target.id, { ...toRow(r), title: r.title || r.target.title, notes: r.target.notes });
            }
            Haptic.tap();
            showToast(`${created + by("replace").length} activité${created > 1 ? "s" : ""} importée${created > 1 ? "s" : ""}`);
            Page.pop();
          } catch (err) {
            go.disabled = false;
            go.textContent = "Réessayer l'import";
            showToast("Import interrompu, réessaie", "warning-circle");
          }
        });
      },
    });
  }

  function previewRow(c) {
    const sport = Storage.sportOrFallback(c.sport);
    const meta = [c.startTime, Fmt.duration(c.durationMinutes), Fmt.distance(c.distanceKm, c.sport)].filter(Boolean).join(" · ");
    return `
      <div class="row">
        ${sportTile(sport, "sm")}
        <span class="row-main"><span class="row-title">${escapeHtml(c.title || sport.name)}</span><span class="row-sub num">${escapeHtml(Fmt.shortDay(c.date))} ${DateUtil.parse(c.date).getFullYear()} · ${escapeHtml(meta)}</span></span>
        <span class="row-value">${c.status === "replace" ? "complète la Semaine" : c.status === "duplicate" ? escapeHtml(c.reason || "") : escapeHtml(Dedupe.sourceLabel(c.source))}</span>
      </div>
    `;
  }

  return { render, openActivity, editActivity, openImport };
})();
