/*
 * week.js — onglet Semaine : les séances prévues du lundi au dimanche,
 * déplaçables par appui long puis glisser-déposer, les semaines types
 * (dupliquer, appliquer un modèle), le prévu vs réalisé et l'abonnement
 * Apple Calendar (flux .ics servi par la fonction Supabase coach-calendar).
 *
 * Cocher une séance la relie à l'activité du même jour et du même sport
 * dans l'historique ; s'il n'y en a pas, une activité est créée à partir
 * de la séance prévue (source "planned"), qu'un import Garmin/Strava
 * viendra remplacer plus tard.
 */

const Week = (() => {
  const screen = document.getElementById("screen-week");
  const CALENDAR_FEED_URL = `${SUPABASE_URL}/functions/v1/coach-calendar`;

  const INTENSITIES = [
    { value: "ef", label: "EF" },
    { value: "tempo", label: "Tempo" },
    { value: "seuil", label: "Seuil" },
    { value: "fractionne", label: "Fractionné" },
    { value: "vma", label: "VMA" },
    { value: "sortie_longue", label: "Sortie longue" },
    { value: "recup", label: "Récup" },
  ];

  let weekStart = DateUtil.weekStart(DateUtil.today());
  let suppressClick = false;

  // ---------------------------------------------------------------------
  // Données de la semaine
  // ---------------------------------------------------------------------

  function days(start = weekStart) {
    return Array.from({ length: 7 }, (_, i) => DateUtil.addDays(start, i));
  }

  function plannedBetween(start, end) {
    return Storage.getPlanned().filter((p) => p.date >= start && p.date <= end);
  }

  function isDone(plan) {
    return !!(plan.activityId || plan.doneAt);
  }

  function intensityLabel(value) {
    const found = INTENSITIES.find((i) => i.value === value);
    return found ? found.label : "";
  }

  // « Course à pied · EF » ou « Musculation · Full body A »
  function planTitle(plan) {
    const sport = Storage.sportOrFallback(plan.sport);
    const program = plan.programId ? Storage.getProgram(plan.programId) : null;
    const detail = program ? program.name : intensityLabel(plan.intensity);
    return detail ? `${sport.name} · ${detail}` : sport.name;
  }

  function planMeta(plan) {
    return [plan.startTime, Fmt.duration(plan.durationMinutes)].filter(Boolean).join(" · ");
  }

  // Prévu vs réalisé sur une semaine (le réalisé compte aussi ce qui n'était pas prévu).
  function summary(start = weekStart) {
    const end = DateUtil.addDays(start, 6);
    const planned = plannedBetween(start, end);
    const activities = Storage.getActivities().filter((a) => a.date >= start && a.date <= end);
    return {
      planned: planned.length,
      done: planned.filter(isDone).length,
      plannedMinutes: planned.reduce((s, p) => s + (p.durationMinutes || 0), 0),
      doneMinutes: activities.reduce((s, a) => s + (a.durationMinutes || 0), 0),
      activities,
      planList: planned,
    };
  }

  // ---------------------------------------------------------------------
  // Cocher / décocher
  // ---------------------------------------------------------------------

  async function toggleDone(plan, done) {
    if (done) {
      const linked = new Set(Storage.getPlanned().map((p) => p.activityId).filter(Boolean));
      let activity = Storage.getActivities().find((a) => a.date === plan.date && a.sport === plan.sport && !linked.has(a.id));
      if (!activity) {
        activity = await Storage.insert("activities", {
          sport: plan.sport,
          date: plan.date,
          startTime: plan.startTime,
          durationMinutes: plan.durationMinutes,
          title: planTitle(plan),
          notes: plan.notes || "",
          source: "planned",
          details: plan.intensity ? { intensity: plan.intensity } : null,
        });
      }
      if (!activity) return showToast("Impossible de cocher, réessaie", "warning-circle");
      await Storage.update("planned", plan.id, { activityId: activity.id, doneAt: new Date().toISOString() });
      showToast(activity.source === "planned" ? "Fait · ajouté à l'historique" : "Fait · relié à ton activité");
    } else {
      const activity = plan.activityId ? Storage.getActivity(plan.activityId) : null;
      if (activity && activity.source === "planned") await Storage.setArchived("activities", activity.id, true);
      await Storage.update("planned", plan.id, { activityId: null, doneAt: null });
    }
    App.renderAll();
  }

  // ---------------------------------------------------------------------
  // Affichage
  // ---------------------------------------------------------------------

  function render() {
    const today = DateUtil.today();
    const end = DateUtil.addDays(weekStart, 6);
    const s = summary();
    const isCurrent = weekStart === DateUtil.weekStart(today);
    const sportMinutes = {};
    s.activities.forEach((a) => (sportMinutes[a.sport] = (sportMinutes[a.sport] || 0) + (a.durationMinutes || 0)));

    screen.innerHTML = `
      ${topbar({
        title: "Semaine",
        trailing: `<button type="button" class="icon-btn" id="week-menu" aria-label="Options de la semaine">${icon("dots-three")}</button>${Settings.button()}`,
      })}
      <div class="hero hero-row">
        <div>
          <p class="eyebrow num">Semaine ${DateUtil.weekNumber(weekStart)} · ${Fmt.shortDay(weekStart)} – ${Fmt.shortDay(end)}</p>
          <h1 class="large-title">${isCurrent ? "Cette semaine" : weekStart < DateUtil.weekStart(today) ? "Semaine passée" : "Semaine à venir"}</h1>
        </div>
        <div class="week-nav">
          <button type="button" class="icon-btn" data-shift="-7" aria-label="Semaine précédente">${icon("caret-left")}</button>
          ${isCurrent ? "" : `<button type="button" class="btn btn-secondary btn-sm" data-today>Auj.</button>`}
          <button type="button" class="icon-btn" data-shift="7" aria-label="Semaine suivante">${icon("caret-right")}</button>
        </div>
      </div>

      <section class="card week-summary">
        <div class="ring-wrap">${ring(s.done, s.planned, 72, 8)}<span class="ring-center">${s.planned ? Math.round((s.done / s.planned) * 100) : 0}%</span></div>
        <div class="week-summary-main">
          <div><span class="metric">${s.done}</span><span class="metric-unit">/ ${s.planned} séances</span></div>
          <p class="metric-sub">${Fmt.duration(s.doneMinutes)} faites · ${Fmt.duration(s.plannedMinutes)} prévues</p>
        </div>
      </section>
      ${
        Object.keys(sportMinutes).length
          ? `<div class="chips week-sports">${Object.entries(sportMinutes)
              .map(([slug, min]) => {
                const sport = Storage.sportOrFallback(slug);
                return `<span class="chip" style="--sport:${escapeHtml(sport.color)}"><span class="chip-dot"></span>${escapeHtml(sport.name)} <span class="num">${Fmt.duration(min)}</span></span>`;
              })
              .join("")}</div>`
          : ""
      }

      <div class="days">
        ${days()
          .map((date) => {
            const plans = s.planList.filter((p) => p.date === date);
            const linked = new Set(plans.map((p) => p.activityId));
            const extra = s.activities.filter((a) => a.date === date && !linked.has(a.id));
            return `
              <section class="day${date === today ? " is-today" : ""}${!plans.length && !extra.length ? " is-empty" : ""}" data-date="${date}">
                <header class="day-head">
                  <span class="day-name">${date === today ? "Aujourd'hui" : escapeHtml(Fmt.weekdayLong(date))}</span>
                  <span class="day-date num">${escapeHtml(Fmt.shortDay(date))}${!plans.length && !extra.length ? " · repos" : ""}</span>
                  <button type="button" class="icon-btn sm" data-add="${date}" aria-label="Prévoir une séance le ${escapeHtml(Fmt.longDay(date))}">${icon("plus")}</button>
                </header>
                <div class="day-items">
                  ${plans.map(planCard).join("")}
                  ${extra.map(extraRow).join("")}
                </div>
              </section>`;
          })
          .join("")}
      </div>
      <p class="section-note" style="text-align:center;margin-top:var(--s-4)">Appui long sur une séance pour la déplacer.</p>
    `;

    screen.querySelectorAll("[data-shift]").forEach((b) =>
      b.addEventListener("click", () => {
        weekStart = DateUtil.addDays(weekStart, Number(b.dataset.shift));
        Haptic.tap();
        render();
      })
    );
    const todayBtn = screen.querySelector("[data-today]");
    if (todayBtn) todayBtn.addEventListener("click", () => {
      weekStart = DateUtil.weekStart(DateUtil.today());
      render();
    });
    screen.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => editPlanned(null, b.dataset.add)));
    screen.querySelector("#week-menu").addEventListener("click", openMenu);
    screen.querySelectorAll("[data-plan]").forEach((card) => {
      const plan = Storage.getPlanned().find((p) => p.id === card.dataset.plan);
      card.querySelector(".check-slot").appendChild(checkButton(isDone(plan), (done) => toggleDone(plan, done), "Fait"));
      card.addEventListener("click", (event) => {
        if (suppressClick || event.target.closest(".check")) return;
        editPlanned(plan);
      });
      enableDrag(card, plan);
    });
    screen.querySelectorAll("[data-activity]").forEach((row) =>
      row.addEventListener("click", () => History.openActivity(Storage.getActivity(row.dataset.activity)))
    );

    Settings.bindButton(screen);
    watchLargeTitle(screen);
  }

  function planCard(plan) {
    const sport = Storage.sportOrFallback(plan.sport);
    return `
      <div class="plan-card${isDone(plan) ? " is-done" : ""}" data-plan="${plan.id}" role="button" tabindex="0">
        ${sportTile(sport)}
        <div class="row-main">
          <p class="row-title">${escapeHtml(planTitle(plan))}</p>
          <p class="row-sub num">${escapeHtml(planMeta(plan))}${plan.notes ? ` · ${escapeHtml(plan.notes)}` : ""}</p>
        </div>
        <span class="check-slot"></span>
      </div>
    `;
  }

  function extraRow(activity) {
    const sport = Storage.sportOrFallback(activity.sport);
    return `
      <button type="button" class="extra-row" data-activity="${activity.id}">
        ${sportTile(sport, "sm")}
        <span class="row-main"><span class="row-title">${escapeHtml(activity.title || sport.name)}</span><span class="row-sub num">Réalisé · ${escapeHtml(Fmt.duration(activity.durationMinutes))}${activity.distanceKm ? ` · ${escapeHtml(Fmt.distance(activity.distanceKm, activity.sport))}` : ""}</span></span>
        ${icon("check-circle", "fill", "extra-check")}
      </button>
    `;
  }

  // ---------------------------------------------------------------------
  // Glisser-déposer (appui long), au doigt comme à la souris
  // ---------------------------------------------------------------------

  function enableDrag(card, plan) {
    let timer = null;
    let start = null;
    let ghost = null;
    let target = null;
    let offset = { x: 0, y: 0 };
    let autoScroll = 0;
    let frame = null;

    const point = (e) => (e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e);

    function begin(p) {
      const rect = card.getBoundingClientRect();
      offset = { x: p.clientX - rect.left, y: p.clientY - rect.top };
      ghost = card.cloneNode(true);
      ghost.classList.add("drag-ghost");
      ghost.style.width = `${rect.width}px`;
      document.body.appendChild(ghost);
      card.classList.add("is-dragging");
      Haptic.tap();
      move(p);
      frame = requestAnimationFrame(scrollLoop);
    }

    function scrollLoop() {
      if (autoScroll) screen.scrollTop += autoScroll;
      frame = requestAnimationFrame(scrollLoop);
    }

    function move(p) {
      ghost.style.transform = `translate(${p.clientX - offset.x}px, ${p.clientY - offset.y}px) scale(1.03)`;
      ghost.hidden = true;
      const under = document.elementFromPoint(p.clientX, p.clientY);
      ghost.hidden = false;
      const day = under ? under.closest(".day") : null;
      if (day !== target) {
        if (target) target.classList.remove("drop-target");
        target = day;
        if (target) {
          target.classList.add("drop-target");
          Haptic.tap();
        }
      }
      autoScroll = p.clientY < 110 ? -10 : p.clientY > window.innerHeight - 130 ? 10 : 0;
    }

    async function end() {
      cancelAnimationFrame(frame);
      autoScroll = 0;
      ghost.remove();
      ghost = null;
      card.classList.remove("is-dragging");
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 300);
      const date = target ? target.dataset.date : null;
      if (target) target.classList.remove("drop-target");
      target = null;
      if (date && date !== plan.date) {
        if (await Storage.update("planned", plan.id, { date })) {
          showToast(`Déplacée au ${Fmt.weekdayLong(date)}`, "arrows-down-up");
          App.renderAll();
        }
      }
    }

    function cancelWait() {
      clearTimeout(timer);
      timer = null;
    }

    card.addEventListener(
      "touchstart",
      (e) => {
        if (e.target.closest(".check")) return;
        start = point(e);
        start = { x: start.clientX, y: start.clientY };
        timer = setTimeout(() => {
          timer = null;
          begin({ clientX: start.x, clientY: start.y });
        }, 320);
      },
      { passive: true }
    );
    card.addEventListener(
      "touchmove",
      (e) => {
        const p = point(e);
        if (ghost) {
          e.preventDefault(); // pas de défilement pendant le glisser
          move(p);
        } else if (timer && Math.hypot(p.clientX - start.x, p.clientY - start.y) > 8) {
          cancelWait();
        }
      },
      { passive: false }
    );
    card.addEventListener("touchend", () => {
      cancelWait();
      if (ghost) end();
    });
    card.addEventListener("touchcancel", () => {
      cancelWait();
      if (ghost) end();
    });
    card.addEventListener("contextmenu", (e) => e.preventDefault());

    // Souris (Mac) : on glisse dès que le pointeur bouge de quelques pixels.
    card.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || e.target.closest(".check")) return;
      const origin = { x: e.clientX, y: e.clientY };
      const onMove = (ev) => {
        if (!ghost && Math.hypot(ev.clientX - origin.x, ev.clientY - origin.y) > 6) begin(ev);
        else if (ghost) move(ev);
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        if (ghost) end();
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ---------------------------------------------------------------------
  // Ajouter / modifier une séance prévue
  // ---------------------------------------------------------------------

  function editPlanned(plan, date = DateUtil.today()) {
    const sports = Storage.getSports();
    const draft = plan
      ? { ...plan }
      : { date, startTime: "", durationMinutes: 60, sport: (sports[0] || {}).slug || "running", intensity: null, notes: "", programId: null };

    const body = html(`
      <div>
        <span class="field-label">Sport</span>
        <div data-sports></div>
        <div class="field-row" style="margin-top:var(--s-5)">
          <label class="field"><span class="field-label">Jour</span><input class="input" type="date" data-date required></label>
          <label class="field"><span class="field-label">Heure (facultatif)</span><input class="input" type="time" data-time></label>
        </div>
        <div data-duration style="margin-bottom:var(--s-5)"></div>
        <div data-variant></div>
        <label class="field"><span class="field-label">Notes</span><textarea class="input" rows="2" placeholder="Ex. 10 × 400 m, récup 1 min" data-notes></textarea></label>
      </div>
    `);

    const sportChips = choiceChips(
      sports.map((s) => ({ value: s.slug, label: s.name, color: s.color, icon: s.icon })),
      draft.sport,
      (v) => {
        draft.sport = v;
        paintVariant();
      }
    );
    sportChips.classList.add("scroll");
    body.querySelector("[data-sports]").appendChild(sportChips);
    body.querySelector("[data-date]").value = draft.date;
    body.querySelector("[data-date]").addEventListener("change", (e) => (draft.date = e.target.value || draft.date));
    body.querySelector("[data-time]").value = draft.startTime || "";
    body.querySelector("[data-time]").addEventListener("change", (e) => (draft.startTime = e.target.value || null));
    body.querySelector("[data-duration]").appendChild(
      stepper({ label: "Durée", value: draft.durationMinutes, step: 5, min: 5, max: 600, unit: "min", onChange: (v) => (draft.durationMinutes = v) }).el
    );
    const notes = body.querySelector("[data-notes]");
    notes.value = draft.notes || "";
    notes.addEventListener("input", () => (draft.notes = notes.value));

    // Intensité pour l'endurance, programme pour la musculation.
    function paintVariant() {
      const box = body.querySelector("[data-variant]");
      box.innerHTML = "";
      if (draft.sport === "strength") {
        draft.intensity = null;
        const programs = Storage.getPrograms();
        box.appendChild(html(`<span class="field-label">Programme</span>`));
        box.appendChild(
          choiceChips([{ value: "", label: "Aucun" }, ...programs.map((p) => ({ value: p.id, label: p.name }))], draft.programId || "", (v) => (draft.programId = v || null))
        );
      } else {
        draft.programId = null;
        box.appendChild(html(`<span class="field-label">Intensité</span>`));
        box.appendChild(choiceChips([{ value: "", label: "—" }, ...INTENSITIES], draft.intensity || "", (v) => (draft.intensity = v || null)));
      }
      box.lastElementChild.style.marginBottom = "var(--s-5)";
    }
    paintVariant();

    const canStart = plan && plan.sport === "strength" && plan.programId && !isDone(plan) && Storage.getProgram(plan.programId);
    const footer = html(`
      <div style="display:contents">
        ${canStart ? `<button type="button" class="btn btn-primary btn-block" data-start>${icon("play", "fill")} Démarrer la séance</button>` : ""}
        <button type="button" class="btn ${canStart ? "btn-secondary" : "btn-primary"} btn-block" data-save>${plan ? "Enregistrer" : "Prévoir la séance"}</button>
        ${plan ? `<button type="button" class="btn btn-ghost btn-block" data-delete>Supprimer</button>` : ""}
      </div>
    `);

    footer.querySelector("[data-save]").addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      const payload = {
        date: draft.date,
        startTime: draft.startTime || null,
        durationMinutes: draft.durationMinutes,
        sport: draft.sport,
        intensity: draft.intensity,
        notes: (draft.notes || "").trim(),
        programId: draft.programId,
      };
      const saved = plan ? await Storage.update("planned", plan.id, payload) : await Storage.insert("planned", payload);
      if (!saved) {
        event.currentTarget.disabled = false;
        return showToast("Enregistrement impossible, réessaie", "warning-circle");
      }
      Haptic.tap();
      sheet.close();
      showToast(plan ? "Séance modifiée" : "Séance prévue");
      App.renderAll();
    });
    const del = footer.querySelector("[data-delete]");
    if (del) {
      del.addEventListener("click", async () => {
        if (await Storage.setArchived("planned", plan.id, true)) {
          sheet.close();
          showToast("Séance supprimée", "trash");
          App.renderAll();
        }
      });
    }
    const startBtn = footer.querySelector("[data-start]");
    if (startBtn) {
      startBtn.addEventListener("click", () => {
        sheet.close();
        Workout.start(Storage.getProgram(plan.programId), plan.id);
      });
    }

    const sheet = Sheet.open({ title: plan ? "Séance prévue" : "Nouvelle séance", body, footer });
  }

  // ---------------------------------------------------------------------
  // Semaines types
  // ---------------------------------------------------------------------

  function openMenu() {
    const actions = [
      { id: "next", icon: "copy", label: "Copier vers la semaine suivante" },
      { id: "prev", icon: "clock-counter-clockwise", label: "Reprendre la semaine précédente" },
      { id: "apply", icon: "squares-four", label: "Appliquer une semaine type" },
      { id: "save", icon: "bookmark-simple", label: "Enregistrer comme semaine type" },
      { id: "calendar", icon: "calendar-dots", label: "S'abonner dans Calendrier" },
    ];
    const body = html(`<div class="list">${actions.map((a) => `<button type="button" class="row" data-action="${a.id}">${icon(a.icon)}<span class="row-title">${escapeHtml(a.label)}</span></button>`).join("")}</div>`);
    body.querySelectorAll("[data-action]").forEach((row) =>
      row.addEventListener("click", () => {
        sheet.close();
        const run = { next: copyToNext, prev: copyFromPrevious, apply: applyTemplate, save: saveTemplate, calendar: openCalendar }[row.dataset.action];
        setTimeout(run, 320);
      })
    );
    const sheet = Sheet.open({ title: "Semaine", body });
  }

  function asTemplateSession(plan) {
    return {
      weekday: DateUtil.weekday(plan.date),
      startTime: plan.startTime,
      durationMinutes: plan.durationMinutes,
      sport: plan.sport,
      intensity: plan.intensity,
      notes: plan.notes,
      programId: plan.programId,
    };
  }

  async function addSessions(start, sessions) {
    const objs = sessions.map((s) => ({
      date: DateUtil.addDays(start, s.weekday),
      startTime: s.startTime || null,
      durationMinutes: s.durationMinutes,
      sport: s.sport,
      intensity: s.intensity || null,
      notes: s.notes || "",
      programId: s.programId && Storage.getProgram(s.programId) ? s.programId : null,
    }));
    try {
      return await Storage.insertMany("planned", objs);
    } catch {
      showToast("Impossible de copier la semaine", "warning-circle");
      return 0;
    }
  }

  async function copyWeek(from, to) {
    const sessions = plannedBetween(from, DateUtil.addDays(from, 6)).map(asTemplateSession);
    if (!sessions.length) return showToast("Aucune séance à copier", "info");
    const existing = plannedBetween(to, DateUtil.addDays(to, 6)).length;
    if (existing) {
      const ok = await confirmSheet({
        title: "La semaine a déjà des séances",
        text: `${existing} séance${existing > 1 ? "s sont" : " est"} déjà prévue${existing > 1 ? "s" : ""}. Ajouter quand même les ${sessions.length} séances copiées ?`,
        confirmLabel: "Ajouter",
      });
      if (!ok) return;
    }
    const count = await addSessions(to, sessions);
    if (count) {
      weekStart = to;
      showToast(`${count} séance${count > 1 ? "s" : ""} copiée${count > 1 ? "s" : ""}`);
      App.renderAll();
    }
  }

  const copyToNext = () => copyWeek(weekStart, DateUtil.addDays(weekStart, 7));
  const copyFromPrevious = () => copyWeek(DateUtil.addDays(weekStart, -7), weekStart);

  function saveTemplate() {
    const sessions = plannedBetween(weekStart, DateUtil.addDays(weekStart, 6)).map(asTemplateSession);
    if (!sessions.length) return showToast("Prévois d'abord des séances cette semaine", "info");
    const body = html(`
      <div>
        <label class="field"><span class="field-label">Nom de la semaine type</span><input class="input" type="text" maxlength="50" placeholder="Ex. Semaine de base, Semaine de charge"></label>
        <p class="card-text">${sessions.length} séance${sessions.length > 1 ? "s" : ""}, avec leurs jours, heures et durées.</p>
      </div>
    `);
    const footer = html(`<button type="button" class="btn btn-primary btn-block">Enregistrer</button>`);
    footer.addEventListener("click", async () => {
      const name = body.querySelector("input").value.trim();
      if (!name) return showToast("Donne-lui un nom", "warning-circle");
      footer.disabled = true;
      if (await Storage.insert("templates", { name, sessions })) {
        sheet.close();
        showToast("Semaine type enregistrée");
      } else {
        footer.disabled = false;
      }
    });
    const sheet = Sheet.open({ title: "Semaine type", body, footer });
    setTimeout(() => body.querySelector("input").focus(), 400);
  }

  function applyTemplate() {
    const body = html(`<div></div>`);
    const paint = () => {
      const templates = Storage.getTemplates();
      body.innerHTML = templates.length
        ? `<div class="list">${templates
            .map(
              (t) => `
              <div class="row">
                <button type="button" class="row-main template-apply" data-apply="${t.id}" style="text-align:left">
                  <span class="row-title">${escapeHtml(t.name)}</span>
                  <span class="row-sub">${t.sessions.length} séance${t.sessions.length > 1 ? "s" : ""} · ${escapeHtml(Fmt.duration(t.sessions.reduce((s, x) => s + (x.durationMinutes || 0), 0)))}</span>
                </button>
                <button type="button" class="icon-btn sm" data-remove="${t.id}" aria-label="Supprimer ${escapeHtml(t.name)}">${icon("trash")}</button>
              </div>`
            )
            .join("")}</div>
           <p class="section-note">Les séances sont ajoutées à la semaine du ${escapeHtml(Fmt.shortDay(weekStart))}.</p>`
        : `<p class="card-text" style="margin:0">Aucune semaine type pour l'instant. Prévois une semaine, puis « Enregistrer comme semaine type ».</p>`;
      body.querySelectorAll("[data-apply]").forEach((b) =>
        b.addEventListener("click", async () => {
          const template = templates.find((t) => t.id === b.dataset.apply);
          sheet.close();
          const count = await addSessions(weekStart, template.sessions);
          if (count) {
            showToast(`« ${template.name} » appliquée`);
            App.renderAll();
          }
        })
      );
      body.querySelectorAll("[data-remove]").forEach((b) =>
        b.addEventListener("click", async () => {
          if (await Storage.setArchived("templates", b.dataset.remove, true)) paint();
        })
      );
    };
    paint();
    const sheet = Sheet.open({ title: "Semaines types", body });
  }

  // ---------------------------------------------------------------------
  // Abonnement Apple Calendar
  // ---------------------------------------------------------------------

  async function openCalendar() {
    const body = html(`<div><p class="card-text" style="margin:0">Chargement du lien…</p></div>`);
    const sheet = Sheet.open({ title: "Apple Calendar", body });

    async function paint(token) {
      if (!token) {
        body.innerHTML = `<p class="card-text" style="margin:0">Lien indisponible pour le moment. Réessaie plus tard.</p>`;
        return;
      }
      const httpsUrl = `${CALENDAR_FEED_URL}?token=${token}`;
      const webcalUrl = httpsUrl.replace(/^https:/, "webcal:");
      body.innerHTML = `
        <div class="calendar-hero">${sportTile({ color: "var(--accent-ink)", icon: "calendar-dots" }, "lg")}</div>
        <p class="card-text" style="margin:0 0 var(--s-5)">Tes séances prévues apparaissent dans le calendrier de l'iPhone, dans un calendrier « Coach.ia », et se mettent à jour toutes seules (environ toutes les heures).</p>
        <a class="btn btn-primary btn-block" href="${escapeHtml(webcalUrl)}">${icon("calendar-plus")} S'abonner dans Calendrier</a>
        <button type="button" class="btn btn-secondary btn-block" data-copy style="margin-top:var(--s-2)">${icon("link")} Copier le lien</button>
        <p class="section-note">Ce lien est secret : toute personne qui l'a peut voir tes séances prévues.</p>
        <button type="button" class="btn btn-ghost btn-block" data-reset>Changer le lien</button>
      `;
      body.querySelector("[data-copy]").addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(webcalUrl);
          showToast("Lien copié", "link");
        } catch {
          prompt("Copie ce lien :", webcalUrl);
        }
      });
      body.querySelector("[data-reset]").addEventListener("click", async () => {
        const ok = await confirmSheet({
          title: "Changer le lien ?",
          text: "L'ancien lien cessera de fonctionner : il faudra te réabonner dans Calendrier.",
          confirmLabel: "Changer le lien",
          danger: true,
        });
        if (ok) {
          await Storage.resetCalendarToken();
          openCalendar();
        }
      });
    }

    paint(await Storage.getCalendarToken());
    return sheet;
  }

  return { render, summary, toggleDone, editPlanned, planTitle, planMeta, isDone, intensityLabel, openCalendar, INTENSITIES };
})();
