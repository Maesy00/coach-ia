/*
 * workout.js — mode séance « sans réfléchir », plein écran, à une main :
 * l'exercice en cours, la charge de la dernière fois, un gros bouton
 * « Valider la série », puis le repos qui démarre tout seul.
 *
 * La séance en cours est gardée dans le navigateur (localStorage) pour ne
 * rien perdre si l'iPhone se verrouille. Le repos est calculé à partir de
 * l'heure de fin, pas d'un compte à rebours : il reste juste même si Safari
 * a été mis en pause entre-temps. Une fois terminée, la séance devient une
 * activité de l'historique (sport "strength").
 */

const Workout = (() => {
  const KEY = "coach.workout";
  const RPE_LABELS = { 1: "Très facile", 2: "Très facile", 3: "Facile", 4: "Facile", 5: "Modéré", 6: "Modéré", 7: "Difficile", 8: "Difficile", 9: "Très difficile", 10: "Maximal" };

  let state = null;
  let root = null;
  let tickId = null;
  let wakeLock = null;
  let view = "set"; // "set" | "finish"
  let finishForm = { rpe: null, notes: "" };

  // ---------------------------------------------------------------------
  // Brouillon
  // ---------------------------------------------------------------------

  function getDraft() {
    if (state) return state;
    try {
      return JSON.parse(localStorage.getItem(KEY)) || null;
    } catch {
      return null;
    }
  }

  function save() {
    try {
      if (state) localStorage.setItem(KEY, JSON.stringify(state));
      else localStorage.removeItem(KEY);
    } catch {
      // Stockage indisponible : la séance continue, sans brouillon.
    }
  }

  function countSets(draft) {
    const all = draft.exercises.flatMap((e) => e.sets);
    return { done: all.filter((s) => s.done).length, total: all.length };
  }

  function progressLabel(draft) {
    const { done, total } = countSets(draft);
    return `${done}/${total} séries`;
  }

  // ---------------------------------------------------------------------
  // Démarrer, reprendre, quitter
  // ---------------------------------------------------------------------

  // Les séries sont pré-remplies avec la dernière fois (sinon avec la cible du programme).
  function makeEntry(item) {
    const exercise = Exercises.byId(item.exerciseId);
    const last = Strength.historyFor(item.exerciseId)[0];
    const count = Number(item.sets) || (last ? last.sets.length : 3);
    const targetReps = parseInt(item.reps, 10);
    const sets = Array.from({ length: count }, (_, i) => {
      const prev = last ? last.sets[Math.min(i, last.sets.length - 1)] : null;
      return {
        reps: prev && prev.reps ? prev.reps : targetReps || 10,
        weight: prev && prev.weight ? prev.weight : item.weight || 0,
        duration: prev && prev.duration ? prev.duration : exercise.metric === "time" ? targetReps || 45 : 0,
        done: false,
      };
    });
    return {
      exerciseId: item.exerciseId,
      target: { sets: count, reps: item.reps || "", weight: item.weight ?? null, rest: item.rest ?? Strength.REST_DEFAULT },
      sets,
    };
  }

  async function start(program, plannedId = null) {
    const existing = getDraft();
    if (existing) {
      const replace = await confirmSheet({
        title: "Une séance est déjà en cours",
        text: `« ${existing.programName || "Séance libre"} » (${progressLabel(existing)}) n'est pas terminée. La remplacer par une nouvelle séance ?`,
        confirmLabel: "Commencer une nouvelle séance",
        danger: true,
      });
      if (!replace) return;
    }
    state = {
      programId: program ? program.id : null,
      programName: program ? program.name : null,
      plannedId,
      startedAt: new Date().toISOString(),
      index: 0,
      rest: null,
      chrono: null,
      exercises: program ? program.exercises.map(makeEntry) : [],
    };
    view = "set";
    finishForm = { rpe: null, notes: "" };
    save();
    open();
  }

  function resume() {
    state = getDraft();
    if (!state) return;
    view = "set";
    open();
  }

  function open() {
    if (!root) {
      root = html(`<div class="workout" role="dialog" aria-modal="true" aria-label="Séance en cours"></div>`);
      document.body.appendChild(root);
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("in")));
    }
    render();
    clearInterval(tickId);
    tickId = setInterval(tick, 250);
    requestWakeLock();
  }

  // Ferme l'écran sans perdre la séance (elle reste « en cours »).
  function minimize() {
    clearInterval(tickId);
    releaseWakeLock();
    if (root) {
      const el = root;
      root = null;
      el.classList.remove("in");
      setTimeout(() => el.remove(), 450);
    }
    App.renderAll();
  }

  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator && !wakeLock) wakeLock = await navigator.wakeLock.request("screen");
    } catch {
      // Refusé (économie d'énergie) : l'écran pourra s'éteindre.
    }
  }

  function releaseWakeLock() {
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // Le verrou d'écran est perdu quand l'app passe en arrière-plan : on le reprend.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && root) {
      wakeLock = null;
      requestWakeLock();
      tick();
    }
  });

  // ---------------------------------------------------------------------
  // Déroulé de la séance
  // ---------------------------------------------------------------------

  function current() {
    const entry = state.exercises[state.index];
    if (!entry) return { entry: null, setIndex: -1 };
    return { entry, setIndex: entry.sets.findIndex((s) => !s.done) };
  }

  function nextPending(fromIndex) {
    for (let i = 1; i <= state.exercises.length; i++) {
      const j = (fromIndex + i) % state.exercises.length;
      if (state.exercises[j].sets.some((s) => !s.done)) return j;
    }
    return -1;
  }

  function validateSet() {
    const { entry, setIndex } = current();
    if (!entry || setIndex < 0) return;
    const set = entry.sets[setIndex];
    if (state.chrono) {
      set.duration = Math.round((Date.now() - state.chrono) / 1000);
      state.chrono = null;
    }
    set.done = true;
    Haptic.tap();

    const moreHere = entry.sets.some((s) => !s.done);
    const next = moreHere ? state.index : nextPending(state.index);
    if (next < 0) {
      state.rest = null;
      save();
      view = "finish";
      render();
      return;
    }
    state.index = next;
    const rest = Number(entry.target.rest) || 0;
    state.rest = rest > 0 ? { until: Date.now() + rest * 1000, total: rest } : null;
    save();
    render({ justDone: true });
  }

  function endRest(natural) {
    state.rest = null;
    save();
    if (natural) {
      playBeep();
      if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
      Haptic.tap();
    }
    render();
  }

  function tick() {
    if (!root || !state) return;
    const elapsed = root.querySelector("[data-elapsed]");
    if (elapsed) elapsed.textContent = Fmt.clock((Date.now() - new Date(state.startedAt).getTime()) / 1000);

    if (state.rest) {
      const left = (state.rest.until - Date.now()) / 1000;
      if (left <= 0) return endRest(true);
      const time = root.querySelector("[data-rest-time]");
      const ring = root.querySelector("[data-rest-ring]");
      if (time) time.textContent = Fmt.clock(Math.ceil(left));
      if (ring) ring.style.strokeDashoffset = String(ring.dataset.length * (1 - left / state.rest.total));
    }
    if (state.chrono) {
      const chrono = root.querySelector("[data-chrono]");
      if (chrono) chrono.textContent = Fmt.clock((Date.now() - state.chrono) / 1000);
    }
  }

  // ---------------------------------------------------------------------
  // Affichage
  // ---------------------------------------------------------------------

  function header() {
    const segments = state.exercises
      .map((e, i) => {
        const done = e.sets.filter((s) => s.done).length / e.sets.length;
        return `<span class="wk-seg${i === state.index && view === "set" ? " current" : ""}"><span style="width:${done * 100}%"></span></span>`;
      })
      .join("");
    return `
      <header class="wk-header">
        <button type="button" class="icon-btn" data-minimize aria-label="Réduire">${icon("caret-down")}</button>
        <div class="wk-title">
          <span class="wk-program">${escapeHtml(state.programName || "Séance libre")}</span>
          <span class="wk-elapsed num" data-elapsed>0:00</span>
        </div>
        <button type="button" class="icon-btn" data-list aria-label="Exercices">${icon("list")}</button>
      </header>
      <div class="wk-progress">${segments}</div>
    `;
  }

  function render(options = {}) {
    if (!root) return;
    if (view === "finish") return renderFinish();
    const { entry, setIndex } = current();
    if (!entry) return renderEmpty();
    if (setIndex < 0) {
      // Exercice terminé (on y est revenu depuis la liste) : on passe au suivant.
      const next = nextPending(state.index);
      if (next < 0) {
        view = "finish";
        return renderFinish();
      }
      state.index = next;
      save();
      return render(options);
    }

    const exercise = Exercises.byId(entry.exerciseId);
    const set = entry.sets[setIndex];
    const last = Strength.historyFor(entry.exerciseId)[0];
    const resting = !!state.rest;

    root.innerHTML = `
      ${header()}
      <main class="wk-body">
        <p class="wk-group">${escapeHtml(Exercises.groups[exercise.group] || "")}</p>
        <h1 class="wk-name">${escapeHtml(exercise.name)}</h1>
        <p class="wk-meta num">Série ${setIndex + 1} sur ${entry.sets.length}${entry.target.reps ? ` · objectif ${escapeHtml(entry.target.reps)}${exercise.metric === "time" ? " s" : ""}` : ""}</p>
        <p class="wk-last">${last ? `${icon("clock-counter-clockwise")} ${escapeHtml(Fmt.shortDay(last.date))} : ${escapeHtml(Strength.formatSets(last.sets, exercise.metric))}` : `${icon("sparkle")} Première fois sur cet exercice`}</p>
        <div class="wk-sets">
          ${entry.sets
            .map((s, i) => {
              const cls = s.done ? "done" : i === setIndex ? "current" : "";
              const label = exercise.metric === "time" ? Fmt.clock(s.duration) : exercise.metric === "bodyweight_reps" ? `${s.reps}` : `${s.reps}×${Fmt.number(s.weight)}`;
              return `<button type="button" class="wk-set ${cls}${options.justDone && i === setIndex - 1 ? " pop" : ""}" data-set="${i}">${s.done ? icon("check", "bold") : ""}<span class="num">${escapeHtml(label)}</span></button>`;
            })
            .join("")}
        </div>
        <div class="wk-stage">${resting ? restMarkup(entry, exercise, set) : `<div class="wk-editors"></div>`}</div>
      </main>
      <footer class="wk-footer">
        ${
          resting
            ? `<div class="btn-row wk-rest-adjust">
                 <button type="button" class="btn btn-secondary" data-rest="-15">−15 s</button>
                 <button type="button" class="btn btn-secondary" data-rest="15">+15 s</button>
               </div>
               <button type="button" class="btn btn-primary btn-block wk-main" data-skip-rest>Passer le repos</button>`
            : `<button type="button" class="btn btn-primary btn-block wk-main" data-validate>${icon("check", "bold")} Valider la série</button>
               <div class="wk-nav">
                 <button type="button" class="btn btn-ghost btn-sm" data-prev ${state.index === 0 ? "disabled" : ""}>${icon("caret-left")} Précédent</button>
                 <button type="button" class="btn btn-ghost btn-sm" data-finish>Terminer</button>
                 <button type="button" class="btn btn-ghost btn-sm" data-next ${state.exercises.length < 2 ? "disabled" : ""}>Suivant ${icon("caret-right")}</button>
               </div>`
        }
      </footer>
    `;

    if (!resting) mountEditors(entry, exercise, set, setIndex);
    bind();
    tick();
  }

  function restMarkup(entry, exercise, set) {
    const size = 232;
    const r = (size - 12) / 2;
    const length = 2 * Math.PI * r;
    const nextLabel =
      exercise.metric === "time" ? Fmt.clock(set.duration) : exercise.metric === "bodyweight_reps" ? `${set.reps} reps` : `${set.reps} × ${Fmt.number(set.weight)} kg`;
    return `
      <div class="wk-rest">
        <div class="ring-wrap">
          <svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
            <circle class="ring-track" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6"/>
            <circle class="ring-value wk-rest-ring" data-rest-ring data-length="${length}" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke-width="6" stroke-dasharray="${length}" stroke-dashoffset="0"/>
          </svg>
          <div class="wk-rest-center">
            <span class="wk-rest-label">Repos</span>
            <span class="wk-rest-time num" data-rest-time>${Fmt.clock(state.rest.total)}</span>
          </div>
        </div>
        <p class="wk-rest-next">Ensuite : <strong>${escapeHtml(exercise.name)}</strong> · ${escapeHtml(nextLabel)}</p>
      </div>
    `;
  }

  // Les gros compteurs : modifier la charge d'une série la reporte sur les suivantes.
  function mountEditors(entry, exercise, set, setIndex) {
    const box = root.querySelector(".wk-editors");
    const propagate = (field, value) => {
      entry.sets.forEach((s, i) => {
        if (i >= setIndex && !s.done) s[field] = value;
      });
      save();
      root.querySelectorAll(".wk-set").forEach((chip, i) => {
        const s = entry.sets[i];
        if (!s.done) chip.querySelector("span").textContent = exercise.metric === "weight_reps" ? `${s.reps}×${Fmt.number(s.weight)}` : exercise.metric === "time" ? Fmt.clock(s.duration) : `${s.reps}`;
      });
    };

    if (exercise.metric === "weight_reps") {
      box.appendChild(stepper({ label: "Charge", value: set.weight, step: 2.5, max: 500, unit: "kg", size: "xl", onChange: (v) => propagate("weight", v) }).el);
    }
    if (exercise.metric !== "time") {
      box.appendChild(
        stepper({
          label: "Répétitions",
          value: set.reps,
          min: 0,
          max: 200,
          size: "xl",
          onChange: (v) => {
            set.reps = v;
            save();
            propagate("reps", v);
          },
        }).el
      );
    } else {
      const chrono = html(`
        <div class="wk-chrono">
          <span class="wk-chrono-time num" data-chrono>${Fmt.clock(state.chrono ? (Date.now() - state.chrono) / 1000 : set.duration)}</span>
          <button type="button" class="btn btn-secondary" data-chrono-toggle>${state.chrono ? `${icon("stop", "fill")} Arrêter` : `${icon("play", "fill")} Chrono`}</button>
        </div>
      `);
      chrono.querySelector("[data-chrono-toggle]").addEventListener("click", () => {
        if (state.chrono) {
          set.duration = Math.round((Date.now() - state.chrono) / 1000);
          state.chrono = null;
        } else {
          state.chrono = Date.now();
        }
        Haptic.tap();
        save();
        render();
      });
      box.appendChild(chrono);
      if (!state.chrono) {
        box.appendChild(stepper({ label: "Durée", value: set.duration, step: 5, max: 3600, unit: "s", size: "xl", onChange: (v) => propagate("duration", v) }).el);
      }
    }
  }

  function bind() {
    const on = (selector, handler) => {
      const el = root.querySelector(selector);
      if (el) el.addEventListener("click", handler);
    };
    on("[data-minimize]", minimize);
    on("[data-list]", openList);
    on("[data-validate]", validateSet);
    on("[data-skip-rest]", () => endRest(false));
    on("[data-finish]", () => {
      view = "finish";
      render();
    });
    on("[data-prev]", () => go(state.index - 1));
    on("[data-next]", () => go((state.index + 1) % state.exercises.length));
    root.querySelectorAll("[data-rest]").forEach((b) =>
      b.addEventListener("click", () => {
        state.rest.until += Number(b.dataset.rest) * 1000;
        state.rest.total = Math.max(1, state.rest.total + Number(b.dataset.rest));
        Haptic.tap();
        save();
        tick();
      })
    );
    // Toucher une série faite permet de la refaire (corriger une charge, un nombre de reps).
    root.querySelectorAll(".wk-set.done").forEach((chip) =>
      chip.addEventListener("click", () => {
        state.exercises[state.index].sets[Number(chip.dataset.set)].done = false;
        state.rest = null;
        save();
        render();
      })
    );
  }

  function go(index) {
    if (index < 0 || index >= state.exercises.length) return;
    state.index = index;
    state.rest = null;
    state.chrono = null;
    Haptic.tap();
    save();
    render();
  }

  function renderEmpty() {
    root.innerHTML = `
      ${header()}
      <main class="wk-body wk-empty">
        <span class="sport-tile lg neutral">${icon("barbell")}</span>
        <h1 class="wk-name">Séance libre</h1>
        <p class="card-text">Ajoute ton premier exercice : la charge de la dernière fois sera proposée.</p>
      </main>
      <footer class="wk-footer">
        <button type="button" class="btn btn-primary btn-block wk-main" data-add>${icon("plus")} Ajouter un exercice</button>
        <div class="wk-nav"><button type="button" class="btn btn-ghost btn-sm" data-abandon>Abandonner</button></div>
      </footer>
    `;
    root.querySelector("[data-minimize]").addEventListener("click", minimize);
    root.querySelector("[data-list]").addEventListener("click", openList);
    root.querySelector("[data-add]").addEventListener("click", addExercise);
    root.querySelector("[data-abandon]").addEventListener("click", abandon);
    tick();
  }

  function addExercise() {
    Strength.pickExercise((exercise) => {
      state.exercises.push(makeEntry({ exerciseId: exercise.id }));
      state.index = state.exercises.length - 1;
      state.rest = null;
      view = "set";
      save();
      render();
    });
  }

  function openList() {
    const body = html(`<div><div class="list"></div><button type="button" class="btn btn-secondary btn-block" style="margin-top:var(--s-4)">${icon("plus")} Ajouter un exercice</button></div>`);
    const list = body.querySelector(".list");
    state.exercises.forEach((entry, i) => {
      const exercise = Exercises.byId(entry.exerciseId);
      const done = entry.sets.filter((s) => s.done).length;
      const row = html(`
        <button type="button" class="row">
          <span class="program-index num${done === entry.sets.length ? " done" : ""}">${done === entry.sets.length ? icon("check", "bold") : i + 1}</span>
          <span class="row-main"><span class="row-title">${escapeHtml(exercise.name)}</span><span class="row-sub num">${done}/${entry.sets.length} séries</span></span>
          ${i === state.index && view === "set" ? `<span class="tag">En cours</span>` : ""}
        </button>
      `);
      row.addEventListener("click", () => {
        sheet.close();
        view = "set";
        go(i);
      });
      list.appendChild(row);
    });
    if (!state.exercises.length) list.innerHTML = `<p class="empty-list">Aucun exercice pour l'instant.</p>`;
    body.querySelector(".btn-secondary").addEventListener("click", () => {
      sheet.close();
      setTimeout(addExercise, 300);
    });
    const sheet = Sheet.open({ title: "Exercices", body });
  }

  // ---------------------------------------------------------------------
  // Fin de séance
  // ---------------------------------------------------------------------

  function doneExercises() {
    return state.exercises
      .map((e) => ({
        exerciseId: e.exerciseId,
        sets: e.sets
          .filter((s) => s.done)
          .map((s) => {
            const metric = Exercises.byId(e.exerciseId).metric;
            if (metric === "time") return { duration: s.duration };
            if (metric === "bodyweight_reps") return { reps: s.reps };
            return { reps: s.reps, weight: s.weight };
          }),
      }))
      .filter((e) => e.sets.length);
  }

  function renderFinish() {
    const exercises = doneExercises();
    const elapsedMin = Math.max(1, Math.round((Date.now() - new Date(state.startedAt).getTime()) / 60000));
    const volume = exercises.reduce((sum, e) => sum + e.sets.reduce((s, x) => s + (x.weight || 0) * (x.reps || 0), 0), 0);
    const setsCount = exercises.reduce((sum, e) => sum + e.sets.length, 0);

    root.innerHTML = `
      ${header()}
      <main class="wk-body wk-finish">
        <h1 class="wk-name">Séance terminée</h1>
        <div class="bento" style="margin-top:var(--s-5)">
          <section class="card"><div class="card-label">${icon("timer")} Durée</div><span class="metric">${Fmt.duration(elapsedMin)}</span></section>
          <section class="card"><div class="card-label">${icon("stack")} Séries</div><span class="metric">${setsCount}</span></section>
          <section class="card span-2"><div class="card-label">${icon("barbell")} Volume soulevé</div><span class="metric">${Fmt.integer(volume)}</span><span class="metric-unit">kg</span></section>
        </div>
        <h3 class="section-label">Ressenti (RPE)</h3>
        <div class="rpe-grid">${Array.from({ length: 10 }, (_, i) => `<button type="button" class="rpe-btn num" data-rpe="${i + 1}" aria-pressed="${finishForm.rpe === i + 1}">${i + 1}</button>`).join("")}</div>
        <p class="section-note" data-rpe-label>${finishForm.rpe ? RPE_LABELS[finishForm.rpe] : "Touche un chiffre : 1 très facile, 10 maximal."}</p>
        <h3 class="section-label">Notes</h3>
        <textarea class="input" rows="3" placeholder="Sensations, douleurs, charges à revoir…"></textarea>
      </main>
      <footer class="wk-footer">
        <button type="button" class="btn btn-primary btn-block wk-main" data-save ${setsCount ? "" : "disabled"}>Enregistrer la séance</button>
        <div class="wk-nav">
          <button type="button" class="btn btn-ghost btn-sm" data-back>${icon("caret-left")} Revenir à la séance</button>
          <button type="button" class="btn btn-ghost btn-sm" data-abandon>Abandonner</button>
        </div>
      </footer>
    `;
    const notes = root.querySelector("textarea");
    notes.value = finishForm.notes;
    notes.addEventListener("input", () => (finishForm.notes = notes.value));
    root.querySelectorAll("[data-rpe]").forEach((b) =>
      b.addEventListener("click", () => {
        finishForm.rpe = Number(b.dataset.rpe);
        Haptic.tap();
        root.querySelectorAll("[data-rpe]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        root.querySelector("[data-rpe-label]").textContent = RPE_LABELS[finishForm.rpe];
      })
    );
    root.querySelector("[data-minimize]").addEventListener("click", minimize);
    root.querySelector("[data-list]").addEventListener("click", openList);
    root.querySelector("[data-back]").addEventListener("click", () => {
      view = "set";
      render();
    });
    root.querySelector("[data-abandon]").addEventListener("click", abandon);
    root.querySelector("[data-save]").addEventListener("click", (e) => finish(e.currentTarget, elapsedMin, exercises));
    tick();
  }

  async function finish(button, durationMinutes, exercises) {
    button.disabled = true;
    const started = new Date(state.startedAt);
    const date = DateUtil.toISO(started);
    const activity = await Storage.insert("activities", {
      sport: "strength",
      date,
      startTime: `${String(started.getHours()).padStart(2, "0")}:${String(started.getMinutes()).padStart(2, "0")}`,
      durationMinutes,
      rpe: finishForm.rpe,
      title: state.programName || "Séance libre",
      notes: finishForm.notes.trim(),
      source: "strength",
      details: { programId: state.programId, programName: state.programName, exercises },
    });
    if (!activity) {
      button.disabled = false;
      showToast("Enregistrement impossible, réessaie", "warning-circle");
      return;
    }

    // Prévu vs réalisé : on coche la séance prévue correspondante.
    const planned =
      (state.plannedId && Storage.getPlanned().find((p) => p.id === state.plannedId)) ||
      Storage.getPlanned().find((p) => p.date === date && p.sport === "strength" && !p.activityId && (!p.programId || p.programId === state.programId));
    if (planned) await Storage.update("planned", planned.id, { activityId: activity.id, doneAt: new Date().toISOString() });

    state = null;
    save();
    Haptic.tap();
    minimize();
    showToast("Séance enregistrée");
  }

  async function abandon() {
    const ok = await confirmSheet({
      title: "Abandonner la séance ?",
      text: "Les séries validées ne seront pas enregistrées.",
      confirmLabel: "Abandonner",
      danger: true,
    });
    if (!ok) return;
    state = null;
    save();
    minimize();
  }

  return { start, resume, getDraft, progressLabel };
})();
