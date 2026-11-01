/*
 * sports.js — les 6 sports par défaut, et les choix proposés quand on
 * ajoute un sport (pictogrammes Phosphor, couleurs discrètes).
 * Les sports eux-mêmes vivent dans Supabase (table coach_sports) :
 * voir Storage.getSports().
 */

const DEFAULT_SPORTS = [
  { slug: "running", name: "Course à pied", icon: "person-simple-run", color: "#e8875b", hasDistance: true },
  { slug: "swimming", name: "Natation", icon: "person-simple-swim", color: "#5ba4e8", hasDistance: true },
  { slug: "cycling", name: "Vélo", icon: "person-simple-bike", color: "#e3b55a", hasDistance: true },
  { slug: "strength", name: "Musculation", icon: "barbell", color: "#a48cf0", hasDistance: false },
  { slug: "yoga", name: "Yoga", icon: "flower-lotus", color: "#4fc1a0", hasDistance: false },
  { slug: "pilates", name: "Pilates", icon: "person-arms-spread", color: "#e57da8", hasDistance: false },
];

const SPORT_ICONS = [
  "person-simple-run", "person-simple-swim", "person-simple-bike", "barbell", "flower-lotus", "person-arms-spread",
  "person-simple-walk", "person-simple-hike", "mountains", "person-simple-ski", "person-simple-snowboard", "waves",
  "soccer-ball", "tennis-ball", "basketball", "volleyball", "boxing-glove", "golf",
  "sneaker-move", "bicycle", "person-simple-tai-chi", "heartbeat", "lightning", "timer",
];

const SPORT_COLORS = [
  "#e8875b", "#5ba4e8", "#e3b55a", "#a48cf0", "#4fc1a0", "#e57da8",
  "#8c9bb0", "#c9a27e", "#4fbfd1", "#e46a6a", "#7c8cf0", "#a3b565",
];

// Pastille carrée teintée à la couleur du sport, avec son pictogramme.
function sportTile(sport, size = "") {
  return `<span class="sport-tile${size ? ` ${size}` : ""}" style="--sport:${escapeHtml(sport.color)}" aria-hidden="true">${icon(sport.icon)}</span>`;
}
