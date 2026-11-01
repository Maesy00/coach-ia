/*
 * Catalogue d'exercices — le même que dans Ironly et Aurora (mêmes ids, pour
 * que l'historique migré reste lié aux bons exercices).
 * "metric" détermine ce qu'on demande à chaque série :
 *   - weight_reps      → charge (kg) + répétitions
 *   - bodyweight_reps  → répétitions seules (poids du corps)
 *   - time             → durée tenue (secondes), ex. gainage
 * Réutilisé par le picker d'exercice, les plans, les séances et les stats.
 * L'utilisateur peut aussi ajouter ses propres exercices (voir Storage).
 */

const EXERCISE_GROUPS = {
  legs: "Jambes",
  core: "Gainage",
  push: "Poussée",
  pull: "Tirage / Dos",
  shoulders: "Épaules",
  arms: "Bras",
  power: "Pliométrie",
};

const DEFAULT_EXERCISES = [
  // ---- Jambes ----
  { id: "squat", name: "Squat", group: "legs", metric: "weight_reps" },
  { id: "squat-avant", name: "Squat avant", group: "legs", metric: "weight_reps" },
  { id: "squat-gobelet", name: "Squat gobelet", group: "legs", metric: "weight_reps" },
  { id: "squat-bulgare", name: "Fentes bulgares", group: "legs", metric: "weight_reps" },
  { id: "souleve-terre", name: "Soulevé de terre", group: "legs", metric: "weight_reps" },
  { id: "souleve-terre-roumain", name: "Soulevé de terre roumain", group: "legs", metric: "weight_reps" },
  { id: "good-morning", name: "Good morning", group: "legs", metric: "weight_reps" },
  { id: "fentes-avant", name: "Fentes avant", group: "legs", metric: "weight_reps" },
  { id: "fentes-marchees", name: "Fentes marchées", group: "legs", metric: "weight_reps" },
  { id: "step-up", name: "Step-up", group: "legs", metric: "weight_reps" },
  { id: "presse-cuisses", name: "Presse à cuisses", group: "legs", metric: "weight_reps" },
  { id: "leg-curl", name: "Leg curl (ischios)", group: "legs", metric: "weight_reps" },
  { id: "leg-extension", name: "Leg extension (quadriceps)", group: "legs", metric: "weight_reps" },
  { id: "hip-thrust", name: "Hip thrust", group: "legs", metric: "weight_reps" },
  { id: "adducteurs", name: "Adducteurs (machine)", group: "legs", metric: "weight_reps" },
  { id: "abducteurs", name: "Abducteurs (machine)", group: "legs", metric: "weight_reps" },
  { id: "mollets-debout", name: "Mollets debout", group: "legs", metric: "weight_reps" },
  { id: "mollets-assis", name: "Mollets assis", group: "legs", metric: "weight_reps" },

  // ---- Gainage ----
  { id: "planche", name: "Planche", group: "core", metric: "time" },
  { id: "gainage-lateral", name: "Gainage latéral", group: "core", metric: "time" },
  { id: "superman", name: "Superman", group: "core", metric: "bodyweight_reps" },
  { id: "releve-jambes", name: "Relevé de jambes", group: "core", metric: "bodyweight_reps" },
  { id: "crunch", name: "Crunch", group: "core", metric: "bodyweight_reps" },
  { id: "pallof-press", name: "Pallof press (anti-rotation)", group: "core", metric: "weight_reps" },
  { id: "rotation-russe", name: "Rotation russe (lestée)", group: "core", metric: "weight_reps" },
  { id: "bird-dog", name: "Bird dog", group: "core", metric: "bodyweight_reps" },
  { id: "dead-bug", name: "Dead bug", group: "core", metric: "bodyweight_reps" },
  { id: "roulette-abdominale", name: "Roulette abdominale", group: "core", metric: "bodyweight_reps" },

  // ---- Poussée ----
  { id: "pompes", name: "Pompes", group: "push", metric: "bodyweight_reps" },
  { id: "developpe-couche", name: "Développé couché (barre)", group: "push", metric: "weight_reps" },
  { id: "developpe-couche-halteres", name: "Développé couché haltères", group: "push", metric: "weight_reps" },
  { id: "developpe-incline", name: "Développé incliné", group: "push", metric: "weight_reps" },
  { id: "dips", name: "Dips", group: "push", metric: "bodyweight_reps" },

  // ---- Tirage / Dos ----
  { id: "tractions", name: "Tractions", group: "pull", metric: "bodyweight_reps" },
  { id: "tirage-horizontal", name: "Tirage horizontal", group: "pull", metric: "weight_reps" },
  { id: "tirage-vertical", name: "Tirage vertical (lat pulldown)", group: "pull", metric: "weight_reps" },
  { id: "rowing-halteres", name: "Rowing haltères", group: "pull", metric: "weight_reps" },
  { id: "rowing-barre", name: "Rowing barre", group: "pull", metric: "weight_reps" },
  { id: "tirage-unilateral", name: "Tirage poitrine unilatéral (poulie)", group: "pull", metric: "weight_reps" },

  // ---- Épaules ----
  { id: "developpe-epaules", name: "Développé épaules", group: "shoulders", metric: "weight_reps" },
  { id: "elevations-laterales", name: "Élévations latérales", group: "shoulders", metric: "weight_reps" },
  { id: "elevations-frontales", name: "Élévations frontales", group: "shoulders", metric: "weight_reps" },
  { id: "oiseau", name: "Oiseau (élévations arrière)", group: "shoulders", metric: "weight_reps" },
  { id: "face-pull", name: "Face pull", group: "shoulders", metric: "weight_reps" },
  { id: "ytw-raise", name: "Y-T-W haltères légers (natation)", group: "shoulders", metric: "weight_reps" },
  { id: "rotation-externe-epaule", name: "Rotation externe épaule (élastique)", group: "shoulders", metric: "bodyweight_reps" },
  { id: "rotation-interne-epaule", name: "Rotation interne épaule (élastique)", group: "shoulders", metric: "bodyweight_reps" },

  // ---- Bras ----
  { id: "curl-biceps", name: "Curl biceps haltères", group: "arms", metric: "weight_reps" },
  { id: "curl-marteau", name: "Curl marteau", group: "arms", metric: "weight_reps" },
  { id: "extension-triceps-poulie", name: "Extension triceps poulie", group: "arms", metric: "weight_reps" },
  { id: "extension-triceps-nuque", name: "Extension triceps nuque", group: "arms", metric: "weight_reps" },

  // ---- Pliométrie ----
  { id: "squat-saute", name: "Squat sauté", group: "power", metric: "bodyweight_reps" },
  { id: "fentes-sautees", name: "Fentes sautées", group: "power", metric: "bodyweight_reps" },
  { id: "box-jump", name: "Box jump", group: "power", metric: "bodyweight_reps" },
  { id: "burpees", name: "Burpees", group: "power", metric: "bodyweight_reps" },
  { id: "skipping", name: "Skipping (montées de genoux)", group: "power", metric: "time" },
  { id: "bondissements", name: "Bondissements", group: "power", metric: "bodyweight_reps" },
];

const Exercises = (() => {
  const METRICS = {
    weight_reps: "Charge + répétitions",
    bodyweight_reps: "Répétitions seules",
    time: "Durée",
  };

  function all() {
    return [...DEFAULT_EXERCISES, ...Storage.getCustomExercises()];
  }

  // Un exercice personnalisé masqué reste lisible dans l'historique.
  function byId(id) {
    return all().find((e) => e.id === id) || { id, name: "Exercice supprimé", group: "core", metric: "weight_reps" };
  }

  function createCustom(name, group, metric) {
    return Storage.insert("customExercises", { name, group, metric });
  }

  return { all, byId, createCustom, groups: EXERCISE_GROUPS, metrics: METRICS };
})();
