/*
 * design-system.js — page de démonstration des composants (Réglages →
 * Design system), pour juger le rendu et les animations sur l'iPhone.
 * Les chiffres affichés ici sont des exemples, pas tes données.
 */

const DesignSystem = (() => {
  const DEMO_WEEKS = [3.2, 4.1, 3.6, 5.0, 4.4, 5.8, 2.9, 5.2, 6.1, 5.5, 6.6, 7.0];

  function open() {
    Page.push({ title: "Design system", backLabel: "Réglages", render });
  }

  function render(content) {
    const sports = Storage.getSports();

    content.innerHTML = `
      <p class="section-note" style="margin:0 4px var(--s-6)">Exemples visuels : aucune de ces valeurs n'est enregistrée.</p>

      <h3 class="section-label">Métriques</h3>
      <div class="bento">
        <section class="card span-2">
          <div class="card-label">${icon("path")} Distance · cette semaine</div>
          <span class="metric metric-display">42,5</span><span class="metric-unit">km</span>
          <p class="metric-sub"><span class="up">+12 %</span> vs semaine dernière</p>
        </section>
        <section class="card">
          <div class="card-label">${icon("heartbeat")} Charge</div>
          <span class="metric">386</span>
          <p class="metric-sub">sRPE · 7 j</p>
        </section>
        <section class="card">
          <div class="card-label">${icon("calendar-check")} Semaine</div>
          <div class="week-card">
            <div><span class="metric">4</span><span class="metric-unit">/ 6</span></div>
            <div class="ring-wrap">${ring(4, 6, 48, 6)}</div>
          </div>
        </section>
      </div>

      <h3 class="section-label">Graphique · touche et glisse</h3>
      <section class="card" id="ds-chart">
        <div class="card-label">${icon("chart-line-up")} Volume hebdomadaire</div>
        <span class="metric num">07:00</span>
      </section>

      <h3 class="section-label">Validation</h3>
      <div class="list" id="ds-checks"></div>

      <h3 class="section-label">Typographie</h3>
      <section class="card ds-type">
        <p class="metric metric-display">1:42:08</p>
        <p class="large-title">Grand titre</p>
        <p class="card-title">Titre de carte</p>
        <p>Texte courant, Geist 16 px, interlignage confortable.</p>
        <p class="card-text">Texte secondaire, 14 px.</p>
        <p class="row-sub">Légende, 13 px</p>
      </section>

      <h3 class="section-label">Boutons</h3>
      <div class="btn-row">
        <button type="button" class="btn btn-primary">${icon("play", "fill")} Démarrer</button>
        <button type="button" class="btn btn-secondary">Secondaire</button>
        <button type="button" class="btn btn-ghost">Discret</button>
        <button type="button" class="btn btn-danger btn-sm">Masquer</button>
        <button type="button" class="btn btn-secondary btn-sm">${icon("plus")} Petit</button>
      </div>

      <h3 class="section-label">Contrôles</h3>
      <div id="ds-segmented"></div>
      <div class="list" style="margin-top:var(--s-3)">
        <label class="row"><span class="row-main"><span class="row-title">Minuteur automatique</span></span><input type="checkbox" class="switch" checked></label>
        <div class="row"><input class="input" type="text" placeholder="Champ de saisie"></div>
      </div>
      <button type="button" class="btn btn-secondary btn-block" id="ds-sheet" style="margin-top:var(--s-3)">Ouvrir une feuille</button>

      <h3 class="section-label">Sports</h3>
      <div class="chips">
        ${sports.map((s) => `<span class="chip" style="--sport:${escapeHtml(s.color)}"><span class="chip-dot"></span>${escapeHtml(s.name)}</span>`).join("")}
      </div>
      <div class="chips" style="margin-top:var(--s-3)">
        <span class="tag">Fait</span><span class="tag tag-neutral">EF</span><span class="tag tag-neutral">Seuil</span><span class="tag tag-neutral">Fractionné</span>
      </div>

      <h3 class="section-label">Couleurs</h3>
      <div class="ds-swatches">
        ${["bg", "surface", "surface-2", "surface-3", "accent", "text", "text-2", "text-3"]
          .map((t) => `<div class="ds-swatch" style="background:var(--${t});${t.startsWith("text") || t === "accent" ? "color:var(--bg)" : ""}">${t}</div>`)
          .join("")}
      </div>
    `;

    const points = DEMO_WEEKS.map((value, i) => ({ label: `S${33 + i}`, value: Math.round(value * 60) }));
    content.querySelector("#ds-chart").appendChild(Chart.line(points, { format: Fmt.duration }));

    const checks = content.querySelector("#ds-checks");
    [
      { title: "Footing EF · 00:45", sport: Storage.getSport("running") },
      { title: "Full body A", sport: Storage.getSport("strength") },
    ].forEach(({ title, sport }) => {
      const row = html(`
        <div class="row demo-task">
          ${sport ? sportTile(sport) : ""}
          <span class="row-main"><span class="row-title">${escapeHtml(title)}</span></span>
        </div>
      `);
      row.appendChild(
        checkButton(false, (done) => {
          row.classList.toggle("is-done", done);
          if (done) showToast("Séance validée");
        })
      );
      checks.appendChild(row);
    });

    content.querySelector("#ds-segmented").appendChild(
      segmented(
        [
          { value: "week", label: "Semaine" },
          { value: "month", label: "Mois" },
          { value: "year", label: "Année" },
        ],
        "week",
        () => {}
      )
    );

    content.querySelector("#ds-sheet").addEventListener("click", () => {
      const footer = html(`<button type="button" class="btn btn-primary btn-block">C'est noté</button>`);
      const sheet = Sheet.open({
        title: "Feuille",
        body: html(`<p class="card-text" style="margin:0">Tire-la vers le bas, touche le fond ou la croix pour la fermer.</p>`),
        footer,
      });
      footer.addEventListener("click", sheet.close);
    });
  }

  return { open };
})();
