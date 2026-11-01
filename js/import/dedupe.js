/*
 * dedupe.js — reconnaître une activité déjà présente, d'où qu'elle vienne
 * (Garmin, Strava, historique Aurora, séance cochée dans la Semaine).
 *
 * Deux activités sont la même si elles ont le même sport et :
 *   - le même identifiant d'origine, ou
 *   - un départ à ± 10 min et une durée proche, quand l'heure est connue des deux côtés,
 *   - sinon (historique Aurora sans heure, dates Strava en UTC) : le même jour à
 *     un jour près, une durée à ± 10 % (ou ± 3 min) et une distance à ± 5 %.
 */

const Dedupe = (() => {
  const minutesOf = (a) => (a.startTime ? Number(a.startTime.slice(0, 2)) * 60 + Number(a.startTime.slice(3, 5)) : null);

  function close(a, b, ratio, abs) {
    if (!a || !b) return true;
    return Math.abs(a - b) <= Math.max(abs, ratio * Math.max(a, b));
  }

  function same(c, a) {
    if (c.externalId && a.externalId && c.externalId === a.externalId) return true;
    if (c.sport !== a.sport) return false;
    const days = DateUtil.daysBetween(a.date, c.date);
    const durationOk = close(c.durationMinutes, a.durationMinutes, 0.1, 3);
    const distanceOk = close(c.distanceKm, a.distanceKm, 0.05, 0.1);

    if (c.startTime && a.startTime && a.source !== "planned") {
      const gap = Math.abs(days * 1440 + minutesOf(c) - minutesOf(a));
      return gap <= 10 && close(c.durationMinutes, a.durationMinutes, 0.25, 5);
    }
    // Une séance cochée depuis la Semaine n'a que la durée prévue : on se contente du jour.
    if (a.source === "planned") return days === 0;
    return Math.abs(days) <= 1 && durationOk && distanceOk;
  }

  /*
   * Classe les candidats :
   *   new       → à importer
   *   duplicate → déjà présent (ignoré)
   *   replace   → remplace une séance cochée depuis la Semaine (même id, données réelles)
   *   unknown   → sport non suivi dans Coach.ia
   * Les doublons à l'intérieur du lot sont aussi écartés (même activité en .FIT et .GPX).
   */
  function classify(candidates, existing) {
    const accepted = [];
    const claimed = new Set();
    // Le FIT (plus complet) passe avant le GPX/TCX de la même activité.
    const isFit = (c) => (/\.fit(\.gz)?$/i.test(c.fileName || "") ? 1 : 0);
    const ordered = [...candidates].sort((a, b) => isFit(b) - isFit(a));

    return ordered.map((c) => {
      if (!c.sport) return { ...c, status: "unknown" };
      // Une séance cochée ne peut être remplacée qu'une fois ; une vraie activité peut avoir plusieurs doublons.
      const match = existing.find((a) => same(c, a) && !(a.source === "planned" && claimed.has(a.id)));
      if (match && match.source !== "planned") return { ...c, status: "duplicate", reason: `déjà là (${sourceLabel(match.source)})`, target: match };
      if (accepted.some((x) => same(c, x))) return { ...c, status: "duplicate", reason: "en double dans les fichiers" };
      if (match) {
        claimed.add(match.id);
        accepted.push(c);
        return { ...c, status: "replace", target: match };
      }
      accepted.push(c);
      return { ...c, status: "new" };
    });
  }

  function sourceLabel(source) {
    return { manual: "saisie", strength: "Muscu", garmin: "Garmin", strava: "Strava", aurora: "Aurora", ironly: "Ironly", planned: "Semaine", gpx: "GPX", pause: "Pause" }[source] || source || "?";
  }

  return { classify, same, sourceLabel };
})();
