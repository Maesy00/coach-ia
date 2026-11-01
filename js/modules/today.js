/*
 * today.js — onglet Aujourd'hui : « Qu'est-ce que je fais aujourd'hui ? »,
 * « Où j'en suis cette semaine ? », « Comment j'évolue ? ».
 * Étape 1 : la structure en bento est en place ; les cartes se rempliront
 * avec la semaine (étape 3) et l'historique (étape 4).
 */

const Today = (() => {
  const screen = document.getElementById("screen-today");

  function render() {
    const sports = Storage.getSports();

    screen.innerHTML = `
      ${topbar({ title: "Aujourd'hui", trailing: Settings.button() })}
      <div class="hero">
        <p class="eyebrow">${escapeHtml(Fmt.longDay(new Date()))}</p>
        <h1 class="large-title">Aujourd'hui</h1>
      </div>

      <div class="bento">
        <section class="card span-2">
          <div class="card-label">${icon("sun")} Séance du jour</div>
          <h2 class="card-title">Rien de prévu aujourd'hui</h2>
          <p class="card-text">Tes séances planifiées apparaîtront ici, avec un bouton pour démarrer.</p>
        </section>

        <section class="card">
          <div class="card-label">${icon("calendar-check")} Semaine</div>
          <div class="week-card">
            <div>
              <span class="metric">0</span><span class="metric-unit">/ 0</span>
              <p class="metric-sub">séances</p>
            </div>
            <div class="ring-wrap">${ring(0, 0, 48, 6)}</div>
          </div>
        </section>

        <section class="card">
          <div class="card-label">${icon("timer")} Volume</div>
          <span class="metric">0</span><span class="metric-unit">h</span>
          <p class="metric-sub">7 derniers jours</p>
        </section>

        <button type="button" class="card span-2 pressable" id="today-sports">
          <div class="card-label">${icon("squares-four")} Tes sports <span class="card-action">${icon("caret-right")}</span></div>
          <div class="sport-strip">
            ${sports
              .map((s) => `<div class="sport-strip-item">${sportTile(s)}<span>${escapeHtml(s.name)}</span></div>`)
              .join("")}
          </div>
        </button>
      </div>
    `;

    screen.querySelector("#today-sports").addEventListener("click", () => Settings.openSports("Aujourd'hui"));
    Settings.bindButton(screen);
    watchLargeTitle(screen);
  }

  return { render };
})();
