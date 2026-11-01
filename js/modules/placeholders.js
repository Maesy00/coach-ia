/*
 * placeholders.js — onglets Semaine, Muscu et Historique en attendant
 * leur étape : on annonce ce qui arrive, sans fausse donnée.
 */

function placeholderScreen({ id, title, iconName, heading, text, step, features }) {
  const screen = document.getElementById(id);

  function render() {
    screen.innerHTML = `
      ${topbar({ title, trailing: Settings.button() })}
      <div class="hero"><h1 class="large-title">${escapeHtml(title)}</h1></div>
      <div class="empty">
        <span class="sport-tile lg neutral">${icon(iconName)}</span>
        <h2 class="card-title">${escapeHtml(heading)}</h2>
        <p>${escapeHtml(text)}</p>
        <span class="tag tag-neutral">Étape ${step}</span>
      </div>
      <div class="list roadmap">
        ${features.map((f) => `<div class="row">${icon(f.icon)}<span class="row-title">${escapeHtml(f.label)}</span></div>`).join("")}
      </div>
    `;
    Settings.bindButton(screen);
    watchLargeTitle(screen);
  }

  return { render };
}

const WeekScreen = placeholderScreen({
  id: "screen-week",
  title: "Semaine",
  iconName: "calendar-blank",
  heading: "Planifie ta semaine",
  text: "Place tes séances du lundi au dimanche, et retrouve-les dans Apple Calendar.",
  step: 3,
  features: [
    { icon: "hand-grabbing", label: "Glisser-déposer jour par jour" },
    { icon: "copy", label: "Semaines types et duplication" },
    { icon: "check-circle", label: "Prévu vs réalisé" },
    { icon: "calendar-dots", label: "Abonnement Apple Calendar" },
  ],
});

const StrengthScreen = placeholderScreen({
  id: "screen-strength",
  title: "Muscu",
  iconName: "barbell",
  heading: "Tes programmes, sans réfléchir",
  text: "Lance un programme : l'app t'affiche l'exercice, la charge de la dernière fois et le repos.",
  step: 2,
  features: [
    { icon: "list-checks", label: "Programmes : séries, répétitions, charges" },
    { icon: "play", label: "Mode séance à une main" },
    { icon: "timer", label: "Minuteur de repos automatique" },
    { icon: "trend-up", label: "Progression et 1RM estimé" },
  ],
});

const HistoryScreen = placeholderScreen({
  id: "screen-history",
  title: "Historique",
  iconName: "chart-line-up",
  heading: "Tout ton entraînement, au même endroit",
  text: "Importe tes fichiers Garmin et Strava, ou saisis une activité à la main.",
  step: 4,
  features: [
    { icon: "file-arrow-up", label: "Import .FIT, .GPX, .TCX et archive Strava" },
    { icon: "funnel", label: "Filtres par sport et par période" },
    { icon: "chart-bar", label: "Volume, charge d'entraînement" },
    { icon: "trophy", label: "Records personnels" },
  ],
});
