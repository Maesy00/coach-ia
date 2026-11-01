/*
 * migration.js — copie des données des anciennes apps dans Coach.ia
 * (Réglages → Reprendre mes données). Les anciennes tables sont seulement
 * LUES : Aurora, Ironly et Pause continuent de fonctionner à l'identique.
 *
 *   Aurora : sessions (historique, détail muscu), strength_plans, strength_custom_exercises
 *   Ironly : ironly_plans, ironly_sessions, ironly_custom_exercises
 *   Pause  : pause_plans de catégorie « sport » (Ma semaine)
 *
 * Chaque ligne copiée garde son origine dans legacy_ref (ex. "aurora:sessions:<id>") :
 * relancer la migration ne crée jamais de doublon. Les exercices perso reçoivent
 * de nouveaux ids, donc programmes et séances sont réécrits avec les nouveaux.
 */

const Migration = (() => {
  // Heures des créneaux de Pause (les mêmes que son flux calendrier).
  const SLOT_TIME = { matin: "07:00", midi: "12:00", apres_midi: "14:00", soir: "18:00" };
  const AURORA_SPORT = { running: "running", swimming: "swimming", cycling: "cycling", strength: "strength", yoga: "yoga" };

  async function readAll(table, filter) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = supabaseClient.from(table).select("*").order("created_at", { ascending: true });
      if (filter) query = filter(query);
      const { data, error } = await query.range(from, from + 999);
      if (error) throw new Error(`${table} : ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  }

  async function readSources() {
    const [sessions, plans, customs, ironlyPlans, ironlySessions, ironlyCustoms, pausePlans] = await Promise.all([
      readAll("sessions", (q) => q.is("archived_at", null)),
      readAll("strength_plans", (q) => q.is("archived_at", null)),
      readAll("strength_custom_exercises", (q) => q.is("archived_at", null)),
      readAll("ironly_plans"),
      readAll("ironly_sessions"),
      readAll("ironly_custom_exercises"),
      readAll("pause_plans", (q) => q.eq("category", "sport")),
    ]);
    return { sessions, plans, customs, ironlyPlans, ironlySessions, ironlyCustoms, pausePlans };
  }

  const ref = (app, table, id) => `${app}:${table}:${id}`;
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const legacyIds = (kind) => new Set(kindList(kind).map((x) => x.legacyRef).filter(Boolean));

  function kindList(kind) {
    return { customExercises: Storage.getCustomExercises, programs: Storage.getPrograms, activities: Storage.getActivities, planned: Storage.getPlanned }[kind]();
  }

  // ---------------------------------------------------------------------
  // Plan de migration (rien n'est écrit ici)
  // ---------------------------------------------------------------------

  function analyse(src) {
    const done = {
      customExercises: legacyIds("customExercises"),
      programs: legacyIds("programs"),
      activities: legacyIds("activities"),
      planned: legacyIds("planned"),
    };

    // Exercices perso : ceux d'Ironly qui existent déjà dans Aurora (même nom) ne sont pas recopiés.
    const auroraNames = new Map(src.customs.map((c) => [norm(c.name), c.id]));
    const customs = [
      ...src.customs.map((c) => ({ legacyRef: ref("aurora", "strength_custom_exercises", c.id), oldId: c.id, name: c.name, group: c.muscle_group, metric: c.metric })),
      ...src.ironlyCustoms
        .filter((c) => !auroraNames.has(norm(c.name)))
        .map((c) => ({ legacyRef: ref("ironly", "ironly_custom_exercises", c.id), oldId: c.id, name: c.name, group: c.muscle_group, metric: c.metric })),
    ];
    const aliasIds = new Map(src.ironlyCustoms.filter((c) => auroraNames.has(norm(c.name))).map((c) => [c.id, auroraNames.get(norm(c.name))]));

    const auroraPlanNames = new Set(src.plans.map((p) => norm(p.name)));
    const programs = [
      ...src.plans.map((p) => ({ legacyRef: ref("aurora", "strength_plans", p.id), oldId: p.id, name: p.name, exercises: p.exercises || [] })),
      ...src.ironlyPlans.filter((p) => !auroraPlanNames.has(norm(p.name))).map((p) => ({ legacyRef: ref("ironly", "ironly_plans", p.id), oldId: p.id, name: p.name, exercises: p.exercises || [] })),
    ];

    // Historique Aurora ; les séances d'Ironly déjà présentes dans Aurora (même jour, détail muscu) sont écartées.
    const auroraStrengthDays = new Set(src.sessions.filter((s) => s.discipline === "strength" && s.details && s.details.exercises).map((s) => s.date));
    const activities = [
      ...src.sessions.map((s) => ({ legacyRef: ref("aurora", "sessions", s.id), row: s, app: "aurora" })),
      ...src.ironlySessions.filter((s) => !auroraStrengthDays.has(s.date)).map((s) => ({ legacyRef: ref("ironly", "ironly_sessions", s.id), row: s, app: "ironly" })),
    ];

    const unknownPause = new Set();
    src.pausePlans.forEach((p) => {
      if (!Importers.mapType(p.activity)) unknownPause.add(p.activity);
    });
    const planned = src.pausePlans.map((p) => ({ legacyRef: ref("pause", "pause_plans", p.id), row: p }));

    const split = (list, kind) => ({ total: list.length, todo: list.filter((x) => !done[kind].has(x.legacyRef)) });
    return {
      aliasIds,
      customs: split(customs, "customExercises"),
      programs: split(programs, "programs"),
      activities: split(activities, "activities"),
      planned: split(planned, "planned"),
      unknownPause: [...unknownPause],
      counts: {
        auroraSessions: src.sessions.length,
        auroraBySport: countBy(src.sessions, (s) => s.discipline),
        ironlySessions: src.ironlySessions.length,
        ironlySkipped: src.ironlySessions.length - activities.filter((a) => a.app === "ironly").length,
        pausePlans: src.pausePlans.length,
      },
    };
  }

  function countBy(list, fn) {
    return list.reduce((acc, x) => ((acc[fn(x)] = (acc[fn(x)] || 0) + 1), acc), {});
  }

  // ---------------------------------------------------------------------
  // Exécution
  // ---------------------------------------------------------------------

  async function run(plan, onStep) {
    // 1. Sports de Pause inconnus → sports perso (ex. « Randonnée »).
    for (const name of plan.unknownPause) {
      if (!Importers.mapType(name)) await Storage.addSport({ name, icon: "person-simple-walk", color: "#8c9bb0", hasDistance: true });
    }

    // 2. Exercices perso, puis table de correspondance ancien id → nouvel id.
    onStep("Exercices personnalisés");
    await Storage.insertMany("customExercises", plan.customs.todo.map(({ legacyRef, name, group, metric }) => ({ legacyRef, name, group, metric })), { ignoreLegacyDuplicates: true });
    const exerciseMap = new Map();
    Storage.getCustomExercises().forEach((e) => {
      if (e.legacyRef) exerciseMap.set(e.legacyRef.split(":")[2], e.id);
    });
    plan.aliasIds.forEach((auroraId, ironlyId) => exerciseMap.set(ironlyId, exerciseMap.get(auroraId)));
    const mapExercise = (id) => exerciseMap.get(id) || id;

    // 3. Programmes (format Ironly { targetSets, targetReps } → { sets, reps, weight, rest }).
    onStep("Programmes");
    await Storage.insertMany(
      "programs",
      plan.programs.todo.map((p) => ({
        legacyRef: p.legacyRef,
        name: p.name,
        exercises: p.exercises.map((e) => ({
          exerciseId: mapExercise(e.exerciseId),
          sets: Number(e.targetSets || e.sets) || 3,
          reps: String(e.targetReps || e.reps || ""),
          weight: e.weight || null,
          rest: e.rest || Strength.REST_DEFAULT,
        })),
      })),
      { ignoreLegacyDuplicates: true }
    );
    const programMap = new Map();
    Storage.getPrograms().forEach((p) => {
      if (p.legacyRef) programMap.set(p.legacyRef.split(":")[2], p.id);
    });

    // 4. Historique. Une activité déjà importée dans Coach.ia (Garmin/Strava) n'est pas recopiée.
    onStep("Historique");
    const existing = Storage.getActivities().filter((a) => !a.legacyRef);
    const remapDetails = (exercises) => (exercises || []).map((e) => ({ ...e, exerciseId: mapExercise(e.exerciseId) }));
    const activities = plan.activities.todo
      .map(({ legacyRef, row, app }) => {
        if (app === "ironly") {
          const exercises = remapDetails(row.exercises);
          const sets = exercises.reduce((s, e) => s + (e.sets || []).length, 0);
          return {
            legacyRef,
            sport: "strength",
            date: row.date,
            durationMinutes: Math.max(20, Math.round(sets * 2.5)),
            title: row.plan_name || "Séance Ironly",
            notes: "Durée estimée (Ironly ne l'enregistrait pas).",
            source: "ironly",
            details: { programId: programMap.get(row.plan_id) || null, programName: row.plan_name || null, exercises },
          };
        }
        const details = row.details && row.details.exercises
          ? { programId: programMap.get(row.details.planId) || null, programName: row.details.planName || null, exercises: remapDetails(row.details.exercises) }
          : row.details || null;
        return {
          legacyRef,
          sport: AURORA_SPORT[row.discipline] || row.discipline,
          date: row.date,
          durationMinutes: row.duration_minutes || 0,
          distanceKm: row.distance_km === null ? null : Number(row.distance_km),
          title: details && details.programName ? details.programName : null,
          notes: row.notes || "",
          source: "aurora",
          details,
        };
      })
      .filter((a) => !existing.some((e) => Dedupe.same(a, e)));
    await Storage.insertMany("activities", activities, { ignoreLegacyDuplicates: true });

    // 5. Semaine de Pause → séances prévues, reliées à l'activité du jour si elle est faite.
    onStep("Séances prévues");
    const linked = new Set(Storage.getPlanned().map((p) => p.activityId).filter(Boolean));
    const planned = plan.planned.todo.map(({ legacyRef, row }) => {
      const sport = Importers.mapType(row.activity) || "running";
      const sportName = Storage.sportOrFallback(sport).name;
      let activityId = null;
      if (row.status === "done") {
        const match = Storage.getActivities().find((a) => a.date === row.date && a.sport === sport && !linked.has(a.id));
        if (match) {
          activityId = match.id;
          linked.add(match.id);
        }
      }
      return {
        legacyRef,
        date: row.date,
        startTime: SLOT_TIME[row.slot] || null,
        durationMinutes: 60,
        sport,
        notes: norm(row.activity) === norm(sportName) ? "" : row.activity,
        activityId,
        doneAt: row.status === "done" ? `${row.date}T12:00:00Z` : null,
      };
    });
    await Storage.insertMany("planned", planned, { ignoreLegacyDuplicates: true });
  }

  // ---------------------------------------------------------------------
  // Écran
  // ---------------------------------------------------------------------

  function open() {
    let state = { step: "intro", plan: null, src: null, error: null, progress: "" };

    Page.push({
      title: "Reprendre mes données",
      backLabel: "Réglages",
      render(content, page) {
        const set = (changes) => {
          state = { ...state, ...changes };
          page.refresh();
        };

        if (state.step === "intro" || state.step === "reading") {
          content.innerHTML = `
            <p class="card-text" style="margin:0 4px var(--s-5)">Copie dans Coach.ia l'historique d'Aurora, les programmes et séances d'Ironly, et les séances de sport de « Ma semaine » dans Pause.</p>
            <div class="list">
              <div class="row">${icon("shield-check")}<span class="row-main"><span class="row-title">Rien n'est modifié dans les anciennes apps</span><span class="row-sub">Leurs données sont seulement lues ; elles continuent de fonctionner.</span></span></div>
              <div class="row">${icon("arrows-clockwise")}<span class="row-main"><span class="row-title">Sans doublon</span><span class="row-sub">Tu peux relancer la reprise : ce qui a déjà été copié est ignoré.</span></span></div>
            </div>
            ${state.error ? `<p class="section-note" style="color:var(--danger)">${escapeHtml(state.error)}</p>` : ""}
            <button type="button" class="btn btn-primary btn-block btn-lg" id="mig-read" style="margin-top:var(--s-6)" ${state.step === "reading" ? "disabled" : ""}>${state.step === "reading" ? "Lecture…" : "Analyser mes données"}</button>
          `;
          content.querySelector("#mig-read").addEventListener("click", async () => {
            set({ step: "reading", error: null });
            try {
              const src = await readSources();
              set({ step: "review", src, plan: analyse(src) });
            } catch (err) {
              set({ step: "intro", error: `Lecture impossible : ${err.message}` });
            }
          });
          return;
        }

        const { plan } = state;
        const line = (label, part) => `
          <div class="row"><span class="row-main"><span class="row-title">${escapeHtml(label)}</span><span class="row-sub num">${part.total} au total · ${part.total - part.todo.length} déjà copié${part.total - part.todo.length > 1 ? "s" : ""}</span></span><span class="row-value num">${part.todo.length ? `+${part.todo.length}` : icon("check-circle", "fill", "extra-check")}</span></div>`;
        const todoCount = plan.customs.todo.length + plan.programs.todo.length + plan.activities.todo.length + plan.planned.todo.length;

        if (state.step === "review" || state.step === "running") {
          content.innerHTML = `
            <div class="list">
              ${line("Activités (Aurora + Ironly)", plan.activities)}
              ${line("Programmes de muscu", plan.programs)}
              ${line("Exercices personnalisés", plan.customs)}
              ${line("Séances prévues (Pause)", plan.planned)}
            </div>
            <p class="section-note">Aurora : ${plan.counts.auroraSessions} séances (${Object.entries(plan.counts.auroraBySport).map(([k, v]) => `${escapeHtml(Storage.sportOrFallback(AURORA_SPORT[k] || k).name)} ${v}`).join(", ")}). Ironly : ${plan.counts.ironlySessions} séance${plan.counts.ironlySessions > 1 ? "s" : ""}${plan.counts.ironlySkipped ? `, dont ${plan.counts.ironlySkipped} déjà dans Aurora` : ""}.</p>
            ${plan.unknownPause.length ? `<p class="section-note">Nouveaux sports créés depuis Pause : ${escapeHtml(plan.unknownPause.join(", "))}.</p>` : ""}
            <button type="button" class="btn btn-secondary btn-block" id="mig-backup" style="margin-top:var(--s-5)">${icon("download-simple")} Télécharger une sauvegarde (JSON)</button>
            ${
              todoCount
                ? `<button type="button" class="btn btn-primary btn-block btn-lg" id="mig-run" style="margin-top:var(--s-2)" ${state.step === "running" ? "disabled" : ""}>${state.step === "running" ? escapeHtml(state.progress || "Copie…") : `Copier ${todoCount} élément${todoCount > 1 ? "s" : ""}`}</button>`
                : `<p class="card-text" style="margin-top:var(--s-5);text-align:center">Tout est déjà dans Coach.ia.</p>`
            }
            ${state.error ? `<p class="section-note" style="color:var(--danger)">${escapeHtml(state.error)}</p>` : ""}
          `;
          content.querySelector("#mig-backup").addEventListener("click", () => downloadBackup(state.src));
          const go = content.querySelector("#mig-run");
          if (go) go.addEventListener("click", async () => {
            set({ step: "running", error: null });
            try {
              await run(plan, (label) => {
                state.progress = `Copie : ${label}…`;
                const btn = content.querySelector("#mig-run");
                if (btn) btn.textContent = state.progress;
              });
              Haptic.tap();
              set({ step: "report", plan: analyse(state.src) });
              App.renderAll();
            } catch (err) {
              set({ step: "review", plan: analyse(state.src), error: `Copie interrompue (${err.message}). Relance : ce qui est déjà copié sera ignoré.` });
            }
          });
          return;
        }

        // Rapport de contrôle : sources vs Coach.ia, sport par sport.
        const migrated = Storage.getActivities().filter((a) => a.legacyRef && a.legacyRef.startsWith("aurora:"));
        const bySport = countBy(migrated, (a) => a.sport);
        const skipped = plan.activities.todo.length;
        content.innerHTML = `
          <div class="empty" style="padding-top:var(--s-4)">
            <span class="check is-done just-done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
            <h2 class="card-title">Reprise terminée</h2>
          </div>
          <h3 class="section-label">Contrôle · historique Aurora</h3>
          <div class="list">
            ${Object.entries(plan.counts.auroraBySport)
              .map(([k, v]) => {
                const got = bySport[AURORA_SPORT[k] || k] || 0;
                return `<div class="row"><span class="row-title" style="flex:1">${escapeHtml(Storage.sportOrFallback(AURORA_SPORT[k] || k).name)}</span><span class="row-value num">${got} / ${v}</span>${got >= v ? icon("check-circle", "fill", "extra-check") : icon("info")}</div>`;
              })
              .join("")}
          </div>
          ${skipped ? `<p class="section-note">${skipped} séance${skipped > 1 ? "s" : ""} non recopiée${skipped > 1 ? "s" : ""} car déjà présente${skipped > 1 ? "s" : ""} dans Coach.ia (import Garmin/Strava) : rien n'est perdu.</p>` : ""}
          <div class="list" style="margin-top:var(--s-4)">
            ${line("Programmes de muscu", plan.programs)}
            ${line("Exercices personnalisés", plan.customs)}
            ${line("Séances prévues (Pause)", plan.planned)}
          </div>
          <button type="button" class="btn btn-primary btn-block" id="mig-done" style="margin-top:var(--s-6)">Terminé</button>
        `;
        content.querySelector("#mig-done").addEventListener("click", () => Page.pop());
      },
    });
  }

  function downloadBackup(src) {
    const blob = new Blob([JSON.stringify({ taken_at: new Date().toISOString(), tables: src }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sauvegarde-sport-${DateUtil.today()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  return { open };
})();
