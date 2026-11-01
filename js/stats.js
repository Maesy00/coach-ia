/*
 * stats.js — calculs partagés par l'Accueil et l'Historique : volume par
 * semaine/mois, charge d'entraînement, records.
 *
 * Charge d'entraînement = sRPE (méthode de Foster) : RPE × durée en minutes.
 * Sans RPE noté, on estime le RPE à partir de l'intensité prévue ou du sport
 * (valeurs modérées), et l'interface le signale comme une estimation.
 */

const Stats = (() => {
  const INTENSITY_RPE = { recup: 2, ef: 3, sortie_longue: 5, tempo: 6, seuil: 7, fractionne: 8, vma: 9 };
  const SPORT_RPE = { strength: 6, yoga: 3, pilates: 4 };

  function rpeOf(activity) {
    if (activity.rpe) return { value: activity.rpe, estimated: false };
    const intensity = activity.details && activity.details.intensity;
    return { value: INTENSITY_RPE[intensity] || SPORT_RPE[activity.sport] || 5, estimated: true };
  }

  function loadOf(activity) {
    return rpeOf(activity).value * (activity.durationMinutes || 0);
  }

  function filter(activities, { sport = null, from = null, to = null } = {}) {
    return activities.filter((a) => (!sport || a.sport === sport) && (!from || a.date >= from) && (!to || a.date <= to));
  }

  function sum(list, fn) {
    return list.reduce((s, x) => s + (fn(x) || 0), 0);
  }

  // [{ start, label, minutes, load, count }] pour les n dernières semaines (la plus ancienne d'abord).
  function weekly(activities, n, today = DateUtil.today()) {
    const thisWeek = DateUtil.weekStart(today);
    return Array.from({ length: n }, (_, i) => {
      const start = DateUtil.addDays(thisWeek, -7 * (n - 1 - i));
      const list = filter(activities, { from: start, to: DateUtil.addDays(start, 6) });
      return { start, label: `S${DateUtil.weekNumber(start)}`, minutes: sum(list, (a) => a.durationMinutes), load: sum(list, loadOf), count: list.length, km: sum(list, (a) => a.distanceKm) };
    });
  }

  // Idem par mois civil.
  function monthly(activities, n, today = DateUtil.today()) {
    const ref = DateUtil.parse(today);
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(ref.getFullYear(), ref.getMonth() - (n - 1 - i), 1);
      const start = DateUtil.toISO(d);
      const end = DateUtil.toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
      const list = filter(activities, { from: start, to: end });
      return { start, label: Fmt.monthShort(start), minutes: sum(list, (a) => a.durationMinutes), load: sum(list, loadOf), count: list.length, km: sum(list, (a) => a.distanceKm) };
    });
  }

  // Charge aiguë (7 derniers jours) vs chronique (moyenne hebdo sur 28 jours).
  function trainingLoad(activities, today = DateUtil.today()) {
    const acute = sum(filter(activities, { from: DateUtil.addDays(today, -6), to: today }), loadOf);
    const chronic = sum(filter(activities, { from: DateUtil.addDays(today, -27), to: today }), loadOf) / 4;
    const ratio = chronic > 0 ? acute / chronic : null;
    let status = "Pas encore assez de données";
    if (ratio !== null) status = ratio > 1.3 ? "En forte hausse" : ratio < 0.8 ? "Allégée" : "Équilibrée";
    const estimated = filter(activities, { from: DateUtil.addDays(today, -27), to: today }).some((a) => rpeOf(a).estimated);
    return { acute, chronic, ratio, status, estimated };
  }

  // Records d'un sport : plus longue distance, plus longue durée, meilleure allure, plus gros D+.
  const PACE_MIN_KM = { running: 5, cycling: 20, swimming: 1 };

  function records(activities, sport) {
    const list = filter(activities, { sport });
    const best = (fn, pick = (a, b) => fn(a) > fn(b)) => list.filter((a) => fn(a) > 0).reduce((b, a) => (!b || pick(a, b) ? a : b), null);
    const out = [];
    const longest = best((a) => a.distanceKm);
    if (longest) out.push({ label: "Plus longue distance", value: Fmt.distance(longest.distanceKm, sport), activity: longest });
    const longestTime = best((a) => a.durationMinutes);
    if (longestTime) out.push({ label: "Plus longue durée", value: Fmt.duration(longestTime.durationMinutes), activity: longestTime });
    const minKm = PACE_MIN_KM[sport];
    if (minKm) {
      const eligible = list.filter((a) => a.distanceKm >= minKm && a.durationMinutes > 0);
      const fastest = eligible.reduce((b, a) => (!b || a.distanceKm / a.durationMinutes > b.distanceKm / b.durationMinutes ? a : b), null);
      if (fastest) {
        out.push({
          label: `Meilleure ${sport === "cycling" ? "vitesse" : "allure"} (≥ ${Fmt.distance(minKm, sport)})`,
          value: Fmt.pace(fastest.distanceKm, fastest.durationMinutes, sport),
          activity: fastest,
        });
      }
    }
    const climb = best((a) => a.elevationM);
    if (climb) out.push({ label: "Plus gros dénivelé", value: `${Fmt.integer(climb.elevationM)} m D+`, activity: climb });
    return out;
  }

  return { rpeOf, loadOf, filter, sum, weekly, monthly, trainingLoad, records };
})();
