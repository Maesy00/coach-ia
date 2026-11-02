/*
 * strength.js — onglet Muscu : programmes (création, modification),
 * sélecteur d'exercices et progression par exercice (charge max,
 * volume, 1RM estimé). Le mode séance est dans workout.js.
 *
 * Exercice d'un programme : { exerciseId, sets, reps ("8-12"), weight (kg ou null), rest (s) }
 * Séance enregistrée (activité "strength") : details.exercises = [{ exerciseId, sets: [{ reps, weight, duration }] }]
 */

const Strength = (() => {
  const screen = document.getElementById("screen-strength");
  const REST_DEFAULT = 90;

  // ---------------------------------------------------------------------
  // Historique et statistiques par exercice
  // ---------------------------------------------------------------------

  function strengthActivities() {
    return Storage.getActivities().filter((a) => a.sport === "strength" && a.details && Array.isArray(a.details.exercises));
  }

  // Séances où l'exercice apparaît, de la plus récente à la plus ancienne.
  function historyFor(exerciseId) {
    return strengthActivities()
      .map((a) => {
        const entry = a.details.exercises.find((e) => e.exerciseId === exerciseId);
        return entry && entry.sets && entry.sets.length ? { date: a.date, activityId: a.id, sets: entry.sets } : null;
      })
      .filter(Boolean);
  }

  // Formule d'Epley, fiable jusqu'à ~12 répétitions.
  function e1rm(weight, reps) {
    if (!weight || !reps) return 0;
    return reps === 1 ? weight : weight * (1 + Math.min(reps, 12) / 30);
  }

  function sessionStats(sets) {
    return {
      top: Math.max(0, ...sets.map((s) => s.weight || 0)),
      volume: sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0),
      e1rm: Math.max(0, ...sets.map((s) => e1rm(s.weight, s.reps))),
      reps: Math.max(0, ...sets.map((s) => s.reps || 0)),
      totalReps: sets.reduce((sum, s) => sum + (s.reps || 0), 0),
      duration: Math.max(0, ...sets.map((s) => s.duration || 0)),
    };
  }

  function formatSets(sets, metric) {
    if (!sets || !sets.length) return "—";
    if (metric === "time") return sets.map((s) => Fmt.clock(s.duration || 0)).join(" · ");
    if (metric === "bodyweight_reps") return sets.map((s) => s.reps || 0).join(" · ") + " reps";
    return sets.map((s) => `${s.reps || 0}×${Fmt.number(s.weight || 0)}`).join(" · ") + " kg";
  }

  function formatTarget(item, metric) {
    const parts = [`${item.sets} × ${item.reps || "—"}${metric === "time" ? " s" : ""}`];
    if (metric === "weight_reps" && item.weight) parts.push(`${Fmt.number(item.weight)} kg`);
    parts.push(`repos ${Fmt.clock(item.rest || REST_DEFAULT)}`);
    return parts.join(" · ");
  }

  // Durée estimée : ~45 s par série + le repos entre les séries.
  function estimatedMinutes(program) {
    const seconds = program.exercises.reduce((sum, e) => sum + e.sets * (45 + (e.rest || REST_DEFAULT)), 0);
    return Math.max(5, Math.round(seconds / 60 / 5) * 5);
  }

  function lastDoneDate(program) {
    const a = strengthActivities().find((x) => x.details.programId === program.id);
    return a ? a.date : null;
  }

  // ---------------------------------------------------------------------
  // Onglet Muscu
  // ---------------------------------------------------------------------

  function render() {
    const programs = Storage.getPrograms();
    const draft = Workout.getDraft();
    const exercised = exercisesWithHistory();

    screen.innerHTML = `
      ${topbar({ title: "Muscu", trailing: Settings.button() })}
      <div class="hero"><h1 class="large-title">Muscu</h1></div>

      ${
        draft
          ? `<button type="button" class="card pressable resume-card" id="strength-resume">
               <div class="card-label">${icon("play-circle", "fill")} Séance en cours</div>
               <h2 class="card-title">${escapeHtml(draft.programName || "Séance libre")}</h2>
               <p class="card-text">${Workout.progressLabel(draft)} · reprendre là où tu en étais</p>
             </button>`
          : ""
      }

      <h3 class="section-label">Programmes</h3>
      <div class="program-list">
        ${programs.map(programCard).join("") || `<div class="card empty-list">Aucun programme pour l'instant.</div>`}
      </div>
      <div class="btn-row" style="margin-top:var(--s-3)">
        <button type="button" class="btn btn-secondary" id="strength-new" style="flex:1">${icon("plus")} Programme</button>
        <button type="button" class="btn btn-secondary" id="strength-free" style="flex:1">${icon("lightning")} Séance libre</button>
      </div>

      <h3 class="section-label">Progression</h3>
      ${
        exercised.length
          ? `<div class="list">${exercised.slice(0, 12).map(progressRow).join("")}</div>
             ${exercised.length > 12 ? `<button type="button" class="btn btn-ghost btn-block" id="strength-all-progress">Voir les ${exercised.length} exercices</button>` : ""}`
          : `<div class="card empty-list">Ta progression apparaîtra après ta première séance.</div>`
      }
    `;

    screen.querySelectorAll("[data-program]").forEach((card) =>
      card.addEventListener("click", (event) => {
        const program = Storage.getProgram(card.dataset.program);
        if (event.target.closest("[data-start]")) Workout.start(program);
        else openProgram(program);
      })
    );
    screen.querySelector("#strength-new").addEventListener("click", () => editProgram(null));
    screen.querySelector("#strength-free").addEventListener("click", () => Workout.start(null));
    const resume = screen.querySelector("#strength-resume");
    if (resume) resume.addEventListener("click", () => Workout.resume());
    screen.querySelectorAll("[data-progress]").forEach((row) => row.addEventListener("click", () => openProgress(row.dataset.progress)));
    const all = screen.querySelector("#strength-all-progress");
    if (all) all.addEventListener("click", openAllProgress);

    Settings.bindButton(screen);
    watchLargeTitle(screen);
  }

  function programCard(program) {
    const last = lastDoneDate(program);
    return `
      <div class="card program-card pressable" data-program="${program.id}" role="button" tabindex="0">
        <div class="program-card-main">
          <h2 class="card-title">${escapeHtml(program.name)}</h2>
          <p class="card-text">${program.exercises.length} exercice${program.exercises.length > 1 ? "s" : ""} · ~${Fmt.duration(estimatedMinutes(program))}${last ? ` · fait le ${Fmt.shortDay(last)}` : ""}</p>
        </div>
        <button type="button" class="play-btn" data-start aria-label="Démarrer ${escapeHtml(program.name)}">${icon("play", "fill")}</button>
      </div>
    `;
  }

  function exercisesWithHistory() {
    const seen = new Map();
    strengthActivities().forEach((a) =>
      a.details.exercises.forEach((e) => {
        if (e.sets && e.sets.length && !seen.has(e.exerciseId)) seen.set(e.exerciseId, a.date);
      })
    );
    return [...seen.entries()].map(([exerciseId, date]) => ({ exerciseId, date }));
  }

  function progressRow({ exerciseId, date }) {
    const exercise = Exercises.byId(exerciseId);
    const history = historyFor(exerciseId);
    const best = headlineValue(exercise, history);
    return `
      <button type="button" class="row" data-progress="${escapeHtml(exerciseId)}">
        <span class="row-main">
          <span class="row-title">${escapeHtml(exercise.name)}</span>
          <span class="row-sub">${history.length} séance${history.length > 1 ? "s" : ""} · dernière le ${Fmt.shortDay(date)}</span>
        </span>
        <span class="row-value">${best}</span>${icon("caret-right", "regular", "row-chevron")}
      </button>
    `;
  }

  function headlineValue(exercise, history) {
    if (!history.length) return "";
    const stats = history.map((h) => sessionStats(h.sets));
    if (exercise.metric === "time") return Fmt.clock(Math.max(...stats.map((s) => s.duration)));
    if (exercise.metric === "bodyweight_reps") return `${Math.max(...stats.map((s) => s.reps))} reps`;
    return `${Fmt.number(Math.max(...stats.map((s) => s.top)))} kg`;
  }

  // ---------------------------------------------------------------------
  // Détail d'un programme
  // ---------------------------------------------------------------------

  function openProgram(program) {
    Page.push({
      title: program.name,
      backLabel: "Muscu",
      render(content, page) {
        const current = Storage.getProgram(program.id);
        if (!current) {
          Page.pop();
          return;
        }
        const totalSets = current.exercises.reduce((s, e) => s + Number(e.sets || 0), 0);
        content.innerHTML = `
          <div class="bento">
            <section class="card"><div class="card-label">${icon("list-checks")} Exercices</div><span class="metric">${current.exercises.length}</span><p class="metric-sub">${totalSets} séries</p></section>
            <section class="card"><div class="card-label">${icon("timer")} Durée</div><span class="metric num">~${Fmt.duration(estimatedMinutes(current))}</span><p class="metric-sub">estimée</p></section>
          </div>
          <button type="button" class="btn btn-primary btn-block btn-lg" id="program-start" style="margin-top:var(--s-4)">${icon("play", "fill")} Démarrer la séance</button>

          <h3 class="section-label">Au programme</h3>
          <div class="list">
            ${current.exercises
              .map((item, i) => {
                const exercise = Exercises.byId(item.exerciseId);
                const last = historyFor(item.exerciseId)[0];
                return `
                  <div class="row program-row">
                    <span class="program-index num">${i + 1}</span>
                    <span class="row-main">
                      <span class="row-title">${escapeHtml(exercise.name)}</span>
                      <span class="row-sub">${escapeHtml(formatTarget(item, exercise.metric))}</span>
                      ${last ? `<span class="row-sub">Dernière fois : ${escapeHtml(formatSets(last.sets, exercise.metric))}</span>` : ""}
                    </span>
                  </div>`;
              })
              .join("")}
          </div>

          <div class="btn-row" style="margin-top:var(--s-6)">
            <button type="button" class="btn btn-secondary" id="program-edit" style="flex:1">${icon("pencil-simple")} Modifier</button>
            <button type="button" class="btn btn-secondary" id="program-copy" style="flex:1">${icon("copy")} Dupliquer</button>
          </div>
          <button type="button" class="btn btn-ghost btn-block" id="program-archive" style="margin-top:var(--s-2)">Supprimer le programme</button>
        `;
        content.querySelector("#program-start").addEventListener("click", () => Workout.start(current));
        content.querySelector("#program-edit").addEventListener("click", () => editProgram(current));
        content.querySelector("#program-copy").addEventListener("click", async () => {
          const copy = await Storage.insert("programs", { name: `${current.name} (copie)`, exercises: current.exercises });
          if (copy) {
            showToast("Programme dupliqué");
            Page.pop();
            openProgram(copy);
          }
        });
        content.querySelector("#program-archive").addEventListener("click", async () => {
          const ok = await confirmSheet({
            title: "Supprimer ce programme ?",
            text: "Les séances déjà faites avec ce programme restent dans ton historique.",
            confirmLabel: "Supprimer",
            danger: true,
          });
          if (ok && (await Storage.setArchived("programs", current.id, true))) {
            showToast("Programme supprimé", "trash");
            Page.pop();
          }
        });
      },
    });
  }

  // ---------------------------------------------------------------------
  // Éditeur de programme
  // ---------------------------------------------------------------------

  function editProgram(program) {
    const draft = {
      name: program ? program.name : "",
      exercises: program ? program.exercises.map((e) => ({ ...e })) : [],
    };

    Page.push({
      title: program ? "Modifier" : "Nouveau programme",
      backLabel: program ? program.name : "Muscu",
      render(content) {
        content.innerHTML = `
          <label class="field">
            <span class="field-label">Nom</span>
            <input class="input" id="program-name" type="text" maxlength="60" placeholder="Ex. Full body A">
          </label>
          <span class="field-label">Exercices</span>
          <div id="program-items" class="program-items"></div>
          <button type="button" class="btn btn-secondary btn-block" id="program-add">${icon("plus")} Ajouter un exercice</button>
          <button type="button" class="btn btn-primary btn-block btn-lg" id="program-save" style="margin-top:var(--s-8)">Enregistrer</button>
        `;
        const nameInput = content.querySelector("#program-name");
        nameInput.value = draft.name;
        nameInput.addEventListener("input", () => (draft.name = nameInput.value));

        const items = content.querySelector("#program-items");
        const paintItems = () => {
          items.innerHTML = "";
          draft.exercises.forEach((item, index) => items.appendChild(itemEditor(item, index, paintItems)));
        };
        function itemEditor(item, index, repaint) {
          const exercise = Exercises.byId(item.exerciseId);
          const el = html(`
            <div class="card program-item">
              <div class="program-item-head">
                <span class="program-index num">${index + 1}</span>
                <div class="row-main">
                  <p class="row-title">${escapeHtml(exercise.name)}</p>
                  <p class="row-sub">${escapeHtml(Exercises.groups[exercise.group] || "")}</p>
                </div>
                <button type="button" class="icon-btn sm" data-move="-1" aria-label="Monter" ${index === 0 ? "disabled" : ""}>${icon("arrow-up")}</button>
                <button type="button" class="icon-btn sm" data-move="1" aria-label="Descendre" ${index === draft.exercises.length - 1 ? "disabled" : ""}>${icon("arrow-down")}</button>
                <button type="button" class="icon-btn sm" data-remove aria-label="Retirer">${icon("x")}</button>
              </div>
              <div class="program-item-grid"></div>
            </div>
          `);
          const grid = el.querySelector(".program-item-grid");
          grid.appendChild(stepper({ label: "Séries", value: item.sets, min: 1, max: 20, onChange: (v) => (item.sets = v) }).el);
          const reps = html(`
            <label class="stepper">
              <span class="stepper-label">${exercise.metric === "time" ? "Durée (s)" : "Répétitions"}</span>
              <input class="input input-compact" type="text" inputmode="text" placeholder="${exercise.metric === "time" ? "45" : "8-12"}">
            </label>
          `);
          reps.querySelector("input").value = item.reps || "";
          reps.querySelector("input").addEventListener("input", (e) => (item.reps = e.target.value.trim()));
          grid.appendChild(reps);
          if (exercise.metric === "weight_reps") {
            grid.appendChild(stepper({ label: "Charge cible", value: item.weight || 0, step: 2.5, max: 500, unit: "kg", onChange: (v) => (item.weight = v || null) }).el);
          }
          grid.appendChild(stepper({ label: "Repos", value: item.rest || REST_DEFAULT, step: 15, min: 0, max: 600, unit: "s", onChange: (v) => (item.rest = v) }).el);

          el.querySelectorAll("[data-move]").forEach((b) =>
            b.addEventListener("click", () => {
              const to = index + Number(b.dataset.move);
              [draft.exercises[index], draft.exercises[to]] = [draft.exercises[to], draft.exercises[index]];
              Haptic.tap();
              repaint();
            })
          );
          el.querySelector("[data-remove]").addEventListener("click", () => {
            draft.exercises.splice(index, 1);
            repaint();
          });
          return el;
        }
        paintItems();

        content.querySelector("#program-add").addEventListener("click", () =>
          pickExercise((exercise) => {
            draft.exercises.push({
              exerciseId: exercise.id,
              sets: 3,
              reps: exercise.metric === "time" ? "45" : "8-12",
              weight: null,
              rest: REST_DEFAULT,
            });
            paintItems();
          })
        );

        content.querySelector("#program-save").addEventListener("click", async (event) => {
          const name = draft.name.trim();
          if (!name) return showToast("Donne un nom au programme", "warning-circle");
          if (!draft.exercises.length) return showToast("Ajoute au moins un exercice", "warning-circle");
          event.currentTarget.disabled = true;
          const payload = { name, exercises: draft.exercises };
          const saved = program ? await Storage.update("programs", program.id, payload) : await Storage.insert("programs", payload);
          if (!saved) {
            event.currentTarget.disabled = false;
            return showToast("Enregistrement impossible, réessaie", "warning-circle");
          }
          Haptic.tap();
          showToast(program ? "Programme modifié" : "Programme créé");
          Page.pop();
        });
      },
    });
  }

  // ---------------------------------------------------------------------
  // Sélecteur d'exercice (recherche + création d'un exercice perso)
  // ---------------------------------------------------------------------

  function pickExercise(onSelect) {
    const body = html(`
      <div>
        <div class="search-field">
          ${icon("magnifying-glass")}
          <input class="input" type="search" placeholder="Rechercher ou créer un exercice" autocomplete="off">
        </div>
        <div class="picker-results"></div>
      </div>
    `);
    const input = body.querySelector("input");
    const results = body.querySelector(".picker-results");
    const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

    function paint() {
      const query = normalize(input.value.trim());
      const matches = Exercises.all().filter((e) => !query || normalize(e.name).includes(query));
      const groups = Object.entries(Exercises.groups);
      const exact = Exercises.all().some((e) => normalize(e.name) === query);
      results.innerHTML = `
        ${query && !exact ? `<button type="button" class="row create-row" data-create>${icon("plus-circle")}<span class="row-title">Créer « ${escapeHtml(input.value.trim())} »</span></button>` : ""}
        ${groups
          .map(([group, label]) => {
            const list = matches.filter((e) => e.group === group);
            if (!list.length) return "";
            return `<h3 class="section-label">${escapeHtml(label)}</h3>
              <div class="list">${list.map((e) => `<button type="button" class="row" data-id="${escapeHtml(e.id)}"><span class="row-title">${escapeHtml(e.name)}</span><span class="row-value">${e.metric === "time" ? "durée" : e.metric === "bodyweight_reps" ? "PDC" : ""}</span></button>`).join("")}</div>`;
          })
          .join("")}
      `;
      results.querySelectorAll("[data-id]").forEach((row) =>
        row.addEventListener("click", () => {
          sheet.close();
          onSelect(Exercises.byId(row.dataset.id));
        })
      );
      const create = results.querySelector("[data-create]");
      if (create) create.addEventListener("click", () => createExercise(input.value.trim()));
    }

    function createExercise(name) {
      const choice = { group: "legs", metric: "weight_reps" };
      results.innerHTML = "";
      const form = html(`
        <div>
          <p class="card-title" style="margin:var(--s-4) 0">${escapeHtml(name)}</p>
          <span class="field-label">Groupe</span>
          <div class="group-chips"></div>
          <span class="field-label" style="margin-top:var(--s-5)">Ce qu'on note à chaque série</span>
          <div class="metric-seg"></div>
          <button type="button" class="btn btn-primary btn-block" style="margin-top:var(--s-6)">Créer l'exercice</button>
        </div>
      `);
      form.querySelector(".group-chips").appendChild(
        choiceChips(Object.entries(Exercises.groups).map(([value, label]) => ({ value, label })), choice.group, (v) => (choice.group = v))
      );
      form.querySelector(".metric-seg").appendChild(
        segmented(Object.entries(Exercises.metrics).map(([value, label]) => ({ value, label: label.split(" ")[0] })), choice.metric, (v) => (choice.metric = v))
      );
      form.querySelector(".btn-primary").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        const created = await Exercises.createCustom(name, choice.group, choice.metric);
        if (!created) {
          event.currentTarget.disabled = false;
          return showToast("Création impossible, réessaie", "warning-circle");
        }
        sheet.close();
        showToast(`${name} ajouté au catalogue`);
        onSelect(created);
      });
      results.appendChild(form);
    }

    input.addEventListener("input", paint);
    paint();
    const sheet = Sheet.open({ title: "Exercice", body });
  }

  // ---------------------------------------------------------------------
  // Progression d'un exercice
  // ---------------------------------------------------------------------

  function openAllProgress() {
    Page.push({
      title: "Progression",
      backLabel: "Muscu",
      render(content) {
        content.innerHTML = `<div class="list">${exercisesWithHistory().map(progressRow).join("")}</div>`;
        content.querySelectorAll("[data-progress]").forEach((row) => row.addEventListener("click", () => openProgress(row.dataset.progress, "Progression")));
      },
    });
  }

  function openProgress(exerciseId, backLabel = "Muscu") {
    const exercise = Exercises.byId(exerciseId);
    const metrics =
      exercise.metric === "weight_reps"
        ? [
            { value: "top", label: "Charge max", unit: "kg" },
            { value: "e1rm", label: "1RM estimé", unit: "kg" },
            { value: "volume", label: "Volume", unit: "kg" },
          ]
        : exercise.metric === "time"
        ? [{ value: "duration", label: "Durée max", unit: "s" }]
        : [
            { value: "reps", label: "Reps max", unit: "reps" },
            { value: "totalReps", label: "Reps totales", unit: "reps" },
          ];
    let metric = metrics[0].value;

    Page.push({
      title: exercise.name,
      backLabel,
      render(content, page) {
        const history = historyFor(exerciseId);
        const chronological = [...history].reverse();
        const all = chronological.map((h) => ({ ...h, stats: sessionStats(h.sets) }));
        const def = metrics.find((m) => m.value === metric);
        const best = all.reduce((b, h) => (h.stats[metric] > (b ? b.stats[metric] : -1) ? h : b), null);
        const first = all[0];
        const last = all[all.length - 1];
        const delta = first && last && first !== last && first.stats[metric] ? (last.stats[metric] / first.stats[metric] - 1) * 100 : null;
        const format = (v) => (metric === "duration" ? Fmt.clock(v) : Fmt.number(Math.round(v * 10) / 10));

        content.innerHTML = `
          <div id="progress-metric" style="margin-bottom:var(--s-4)"></div>
          <section class="card" id="progress-chart">
            <div class="card-label">${icon("trend-up")} ${escapeHtml(def.label)}</div>
            <span class="metric metric-display">${last ? format(last.stats[metric]) : "—"}</span><span class="metric-unit">${metric === "duration" ? "" : def.unit}</span>
            <p class="metric-sub">${delta !== null ? `<span class="${delta >= 0 ? "up" : ""}">${delta >= 0 ? "+" : ""}${Fmt.integer(delta)} %</span> depuis le ${Fmt.shortDay(first.date)}` : "dernière séance"}</p>
          </section>
          <div class="bento" style="margin-top:var(--s-3)">
            <section class="card"><div class="card-label">${icon("trophy")} Record</div><span class="metric">${best ? format(best.stats[metric]) : "—"}</span><p class="metric-sub">${best ? Fmt.shortDay(best.date) : ""}</p></section>
            <section class="card"><div class="card-label">${icon("calendar-check")} Séances</div><span class="metric">${all.length}</span><p class="metric-sub">au total</p></section>
          </div>
          <h3 class="section-label">Historique</h3>
          <div class="list">
            ${history
              .map(
                (h) => `<div class="row"><span class="row-main"><span class="row-title">${escapeHtml(Fmt.longDay(h.date))}</span><span class="row-sub">${escapeHtml(formatSets(h.sets, exercise.metric))}</span></span><span class="row-value">${format(sessionStats(h.sets)[metric])}</span></div>`
              )
              .join("")}
          </div>
        `;
        if (metrics.length > 1) {
          content.querySelector("#progress-metric").appendChild(
            segmented(metrics, metric, (v) => {
              metric = v;
              page.refresh();
            })
          );
        }
        if (all.length >= 2) {
          content.querySelector("#progress-chart").appendChild(
            Chart.line(
              all.map((h) => ({ label: Fmt.shortDay(h.date), value: h.stats[metric] })),
              { unit: metric === "duration" ? "s" : def.unit, format: (v) => Fmt.number(Math.round(v * 10) / 10) }
            )
          );
        }
      },
    });
  }

  return { render, historyFor, sessionStats, formatSets, formatTarget, pickExercise, openProgram, REST_DEFAULT };
})();
