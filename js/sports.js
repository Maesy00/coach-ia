/*
 * sports.js — les 6 sports par défaut, et les choix proposés quand on
 * ajoute un sport (pictogrammes Phosphor, couleurs discrètes).
 * Les sports eux-mêmes vivent dans Supabase (table coach_sports) :
 * voir Storage.getSports().
 */

const DEFAULT_SPORTS = [
  { slug: "running", name: "Course à pied", icon: "sneaker-move", color: "#e8603c", hasDistance: true },
  { slug: "swimming", name: "Natation", icon: "waves", color: "#2f7fe0", hasDistance: true },
  { slug: "cycling", name: "Vélo", icon: "bicycle", color: "#d9a21b", hasDistance: true },
  { slug: "strength", name: "Musculation", icon: "barbell", color: "#7a5af0", hasDistance: false },
  { slug: "yoga", name: "Yoga", icon: "flower-lotus", color: "#1f9e7a", hasDistance: false },
  { slug: "pilates", name: "Pilates", icon: "spiral", color: "#d6457f", hasDistance: false },
];

// Apparence des sports par défaut avant la direction monochrome : un sport
// encore réglé ainsi (jamais personnalisé) passe à la nouvelle apparence.
const LEGACY_DEFAULT_LOOK = {
  running: { icon: "person-simple-run", color: "#e8875b" },
  swimming: { icon: "person-simple-swim", color: "#5ba4e8" },
  cycling: { icon: "person-simple-bike", color: "#e3b55a" },
  strength: { icon: "barbell", color: "#a48cf0" },
  yoga: { icon: "flower-lotus", color: "#4fc1a0" },
  pilates: { icon: "person-arms-spread", color: "#e57da8" },
};

// Pictogrammes au trait, abstraits (pas de silhouettes), pour rester
// cohérents avec les autres icônes de l'interface.
const SPORT_ICONS = [
  "sneaker-move", "waves", "bicycle", "barbell", "flower-lotus", "spiral",
  "footprints", "mountains", "path", "boat", "snowflake", "wind",
  "tree", "target", "soccer-ball", "tennis-ball", "basketball", "volleyball",
  "boxing-glove", "golf", "heartbeat", "lightning", "timer", "infinity",
];

// Couleurs des points de sport : franches, même intensité, jamais en aplat.
const SPORT_COLORS = [
  "#e8603c", "#2f7fe0", "#d9a21b", "#7a5af0", "#1f9e7a", "#d6457f",
  "#6b7a90", "#a87a4f", "#1aa3c4", "#d84a4a", "#4b5fd6", "#7f9a2e",
];

// Pastille neutre avec le pictogramme du sport ; sa couleur est un point dans le coin.
function sportTile(sport, size = "") {
  return `<span class="sport-tile${size ? ` ${size}` : ""}" style="--sport:${escapeHtml(sport.color)}" aria-hidden="true">${icon(sport.icon)}</span>`;
}
