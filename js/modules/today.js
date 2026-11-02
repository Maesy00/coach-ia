/*
 * today.js — onglet Aujourd'hui, qui répond en un coup d'œil à :
 * « Qu'est-ce que je fais aujourd'hui ? », « Où j'en suis cette semaine
 * (prévu vs réalisé) ? » et « Comment j'évolue ? ».
 */

const Today = (() => {
  const screen = document.getElementById("screen-today");

  function render() {
    const today = DateUtil.today();
    const activities = Storage.getActivities();
    const todays = Storage.getPlanned().filter((p) => p.date === today);
    const pending = todays.filter((p) => !Week.isDone(p));
    const next = Storage.getPlanned().find((p) => p.date > today && !Week.isDone(p));
    const week = Week.summary(DateUtil.weekStart(today));
    const last7 = Stats.sum(Stats.filter(activities, { from: DateUtil.addDays(today, -6) }), (a) => a.durationMinutes);
    const prev7 = Stats.sum(Stats.filter(activities, { from: DateUtil.addDays(today, -13), to: DateUtil.addDays(today, -7) }), (a) => a.durationMinutes);
    const weeks = Stats.weekly(activities, 12);
    const load = Stats.trainingLoad(activities);
    const last = activities[0];
    const draft = Workout.getDraft();
    const delta = prev7 ? Math.round((last7 / prev7 - 1) * 100) : null;

    screen.innerHTML = `
      ${topbar({ title: "Aujourd'hui", trailing: Settings.button() })}
      <div class="hero">
        <p class="eyebrow">${escapeHtml(Fmt.longDay(new Date()))}</p>
        <h1 class="large-title">Aujourd'hui</h1>
      </div>

      <div class="bento">
        ${
          draft
            ? `<button type="button" class="card span-2 pressable resume-card" id="today-resume">
                 <div class="card-label">${icon("play-circle", "fill")} Séance en cours</div>
                 <h2 class="card-title">${escapeHtml(draft.programName || "Séance libre")}</h2>
                 <p class="card-text">${Workout.progressLabel(draft)} · reprendre</p>
               </button>`
            : ""
        }
        ${sessionCard(todays, pending, next)}

        <button type="button" class="card pressable" id="today-week">
          <div class="card-label">${icon("calendar-check")} Semaine</div>
          <div class="week-card">
            <div>
              <span class="metric">${week.done}</span><span class="metric-unit">/ ${week.planned}</span>
              <p class="metric-sub">séances</p>
            </div>
            <div class="ring-wrap">${ring(week.done, week.planned, 48, 6)}</div>
          </div>
        </button>

        <section class="card">
          <div class="card-label">${icon("timer")} 7 jours</div>
          <span class="metric num">${Fmt.duration(last7)}</span>
          <p class="metric-sub">${delta === null ? "d'entraînement" : `<span class="${delta >= 0 ? "up" : ""}">${delta >= 0 ? "+" : ""}${delta} %</span> vs 7 j avant`}</p>
        </section>

        <section class="card span-2" id="today-trend">
          <div class="card-label">${icon("trend-up")} Volume · 12 semaines</div>
          <span class="metric num">${Fmt.duration(weeks[weeks.length - 1].minutes)}</span><span class="metric-unit">cette semaine</span>
        </section>

        <section class="card">
          <div class="card-label">${icon("heartbeat")} Charge</div>
          <span class="metric">${load.ratio !== null ? Fmt.number(Math.round(load.ratio * 100) / 100) : "—"}</span>
          <p class="metric-sub">${escapeHtml(load.status)}</p>
        </section>

        ${
          last
            ? `<button type="button" class="card pressable" id="today-last">
                 <div class="card-label">${icon("clock-counter-clockwise")} Dernière</div>
                 ${sportTile(Storage.sportOrFallback(last.sport), "sm")}
                 <p class="row-title" style="margin-top:var(--s-2)">${escapeHtml(last.title || Storage.sportOrFallback(last.sport).name)}</p>
                 <p class="metric-sub" style="margin-top:2px">${escapeHtml(Fmt.shortDay(last.date))} · ${escapeHtml(Fmt.duration(last.durationMinutes))}</p>
               </button>`
            : `<section class="card"><div class="card-label">${icon("clock-counter-clockwise")} Dernière</div><p class="card-text">Aucune activité encore.</p></section>`
        }
      </div>
    `;

    if (weeks.some((w) => w.minutes > 0)) {
      screen.querySelector("#today-trend").appendChild(Chart.line(weeks.map((w) => ({ label: `${w.label} · ${Fmt.shortDay(w.start)}`, value: w.minutes })), { format: Fmt.duration, height: 96 }));
    }
    bindSession(todays, pending);
    screen.querySelector("#today-week").addEventListener("click", () => App.go("week"));
    const lastBtn = screen.querySelector("#today-last");
    if (lastBtn) lastBtn.addEventListener("click", () => History.openActivity(last));
    const resume = screen.querySelector("#today-resume");
    if (resume) resume.addEventListener("click", () => Workout.resume());

    Settings.bindButton(screen);
    watchLargeTitle(screen);
  }

  function sessionCard(todays, pending, next) {
    if (pending.length) {
      const main = pending[0];
      const sport = Storage.sportOrFallback(main.sport);
      const program = main.programId ? Storage.getProgram(main.programId) : null;
      return `
        <section class="card span-2 today-session" style="--sport:${escapeHtml(sport.color)}">
          <div class="card-label">${icon("sun")} À faire aujourd'hui${pending.length > 1 ? `<span class="card-action num">${pending.length} séances</span>` : ""}</div>
          <div class="today-main">
            ${sportTile(sport, "lg")}
            <div class="row-main">
              <h2 class="card-title">${escapeHtml(Week.planTitle(main))}</h2>
              <p class="card-text num">${escapeHtml(Week.planMeta(main))}</p>
            </div>
          </div>
          ${main.notes ? `<p class="today-notes">${escapeHtml(main.notes)}</p>` : ""}
          <div class="btn-row" style="margin-top:var(--s-4)">
            ${program ? `<button type="button" class="btn btn-primary" data-start="${main.id}" style="flex:1">${icon("play", "fill")} Démarrer</button>` : ""}
            <button type="button" class="btn ${program ? "btn-secondary" : "btn-primary"}" data-done="${main.id}" style="flex:1">${icon("check")} C'est fait</button>
          </div>
          ${
            pending.length > 1
              ? `<div class="today-more">${pending
                  .slice(1)
                  .map((p) => `<button type="button" class="extra-row" data-open="${p.id}">${sportTile(Storage.sportOrFallback(p.sport), "sm")}<span class="row-main"><span class="row-title">${escapeHtml(Week.planTitle(p))}</span><span class="row-sub num">${escapeHtml(Week.planMeta(p))}</span></span></button>`)
                  .join("")}</div>`
              : ""
          }
        </section>
      `;
    }
    if (todays.length) {
      return `
        <section class="card span-2 today-done">
          <div class="card-label">${icon("sun")} Aujourd'hui</div>
          <div class="today-main">
            <span class="check is-done" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
            <div class="row-main">
              <h2 class="card-title">C'est fait pour aujourd'hui</h2>
              <p class="card-text">${todays.map((p) => escapeHtml(Week.planTitle(p))).join(" · ")}</p>
            </div>
          </div>
        </section>
      `;
    }
    return `
      <section class="card span-2">
        <div class="card-label">${icon("sun")} Aujourd'hui</div>
        <h2 class="card-title">Rien de prévu</h2>
        <p class="card-text">${next ? `Prochaine séance : ${escapeHtml(Fmt.weekdayLong(next.date))} · ${escapeHtml(Week.planTitle(next))}` : "Jour de repos, ou prévois une séance."}</p>
        <div class="btn-row" style="margin-top:var(--s-4)">
          <button type="button" class="btn btn-secondary btn-sm" data-plan-today>${icon("plus")} Prévoir</button>
          <button type="button" class="btn btn-ghost btn-sm" data-log>Saisir une activité</button>
        </div>
      </section>
    `;
  }

  function bindSession(todays, pending) {
    const find = (id) => Storage.getPlanned().find((p) => p.id === id);
    screen.querySelectorAll("[data-start]").forEach((b) =>
      b.addEventListener("click", () => {
        const plan = find(b.dataset.start);
        Workout.start(Storage.getProgram(plan.programId), plan.id);
      })
    );
    screen.querySelectorAll("[data-done]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        Haptic.tap();
        await Week.toggleDone(find(b.dataset.done), true);
      })
    );
    screen.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => Week.editPlanned(find(b.dataset.open))));
    const plan = screen.querySelector("[data-plan-today]");
    if (plan) plan.addEventListener("click", () => Week.editPlanned(null, DateUtil.today()));
    const log = screen.querySelector("[data-log]");
    if (log) log.addEventListener("click", () => History.editActivity(null));
  }

  return { render };
})();
