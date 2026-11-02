/*
 * stats.js — calculs partagés par l'Accueil et l'Historique : volume par
 * semaine/mois, charge d'entraînement, records.
 *
 * Charge d'entraînement = RPE × durée en minutes (sRPE, méthode de Foster).
 * Le RPE vient, dans l'ordre :
 *   1. de ce que tu as noté (RPE ressenti) ;
 *   2. de la fréquence cardiaque, si l'activité a une FC moyenne et que la FC de
 *      repos et la FC max sont renseignées (TRIMP de Banister, ramené à l'échelle
 *      du RPE pour pouvoir additionner les deux) ;
 *   3. sinon d'une estimation (intensité prévue, sport, ou 5), signalée comme telle.
 */

const Stats = (() => {
  const INTENSITY_RPE = { recup: 2, ef: 3, sortie_longue: 5, tempo: 6, seuil: 7, fractionne: 8, vma: 9 };
  const SPORT_RPE = { strength: 6, yoga: 3, pilates: 4 };

  // TRIMP de Banister par minute : FCr × a × e^(b × FCr), avec FCr = (FC moy − FC repos) / (FC max − FC repos).
  // Coefficients : homme a = 0,64, b = 1,92 ; femme a = 0,86, b = 1,67.
  // × 2,8 le ramène sur l'échelle du RPE : FCr 0,5 ≈ 2 (facile), 0,7 ≈ 5, 0,9 ≈ 9.
  const TRIMP_TO_RPE = 2.8;

  function hrRpe(activity) {
    const { restHr, maxHr, trimpProfile } = Storage.getSettings();
    if (!activity.avgHr || !restHr || !maxHr || maxHr <= restHr) return null;
    const hrr = Math.min(1, Math.max(0, (activity.avgHr - restHr) / (maxHr - restHr)));
    const [a, b] = trimpProfile === "f" ? [0.86, 1.67] : [0.64, 1.92];
    return Math.min(10, Math.max(1, TRIMP_TO_RPE * hrr * a * Math.exp(b * hrr)));
  }

  // source : "rpe" (noté), "fc" (fréquence cardiaque) ou "estimate"
  function rpeOf(activity) {
    if (activity.rpe) return { value: activity.rpe, estimated: false, source: "rpe" };
    const fromHr = hrRpe(activity);
    if (fromHr !== null) return { value: fromHr, estimated: false, source: "fc" };
    const intensity = activity.details && activity.details.intensity;
    return { value: INTENSITY_RPE[intensity] || SPORT_RPE[activity.sport] || 5, estimated: true, source: "estimate" };
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

  // FC la plus haute vue dans les activités : point de départ pour la FC max.
  function observedMaxHr(activities) {
    return activities.reduce((max, a) => Math.max(max, a.maxHr || 0), 0) || null;
  }

  return { rpeOf, loadOf, filter, sum, weekly, monthly, trainingLoad, records, observedMaxHr };
})();
