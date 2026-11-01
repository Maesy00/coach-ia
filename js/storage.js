/*
 * Storage.js — seul endroit qui lit/écrit les données de Coach.ia.
 * Parle à la base Supabase en ligne (tables coach_*, synchronisées entre
 * appareils). Comme dans Aurora et Pause, les getters restent synchrones :
 * ils lisent un cache local mis à jour après chaque appel réseau.
 *
 * Archivage : rien n'est effacé. « Masquer » renseigne archived_at,
 * et les éléments archivés sont simplement exclus de l'affichage.
 */

const Storage = (() => {
  let cachedSports = [];
  let userEmail = "";

  function rowToSport(row) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      icon: row.icon,
      color: row.color,
      hasDistance: row.has_distance,
      position: row.position,
      isDefault: row.is_default,
      archivedAt: row.archived_at,
    };
  }

  async function currentUser() {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    return user;
  }

  // Crée les sports par défaut qui manquent. Un sport par défaut masqué
  // reste masqué : le conflit sur (user_id, slug) est simplement ignoré.
  async function ensureDefaultSports(userId) {
    const known = new Set(cachedSports.map((s) => s.slug));
    const missing = DEFAULT_SPORTS.filter((s) => !known.has(s.slug));
    if (!missing.length) return false;

    const rows = missing.map((s) => ({
      user_id: userId,
      slug: s.slug,
      name: s.name,
      icon: s.icon,
      color: s.color,
      has_distance: s.hasDistance,
      position: DEFAULT_SPORTS.indexOf(s),
      is_default: true,
    }));
    const { error } = await supabaseClient
      .from("coach_sports")
      .upsert(rows, { onConflict: "user_id,slug", ignoreDuplicates: true });
    if (error) console.error("Erreur de création des sports par défaut :", error.message);
    return !error;
  }

  async function loadSports() {
    const { data, error } = await supabaseClient
      .from("coach_sports")
      .select("*")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      console.error("Erreur de chargement des sports :", error.message);
      return false;
    }
    cachedSports = data.map(rowToSport);
    return true;
  }

  async function refresh() {
    const user = await currentUser();
    userEmail = user ? user.email : "";
    const ok = await loadSports();
    if (ok && user && (await ensureDefaultSports(user.id))) await loadSports();
    return ok;
  }

  // ---- Compte ----

  function getUserEmail() {
    return userEmail;
  }

  // ---- Sports ----

  function getSports() {
    return cachedSports.filter((s) => !s.archivedAt);
  }

  function getArchivedSports() {
    return cachedSports.filter((s) => s.archivedAt);
  }

  function getSport(id) {
    return cachedSports.find((s) => s.id === id || s.slug === id) || null;
  }

  async function addSport(sport) {
    const user = await currentUser();
    const position = cachedSports.reduce((max, s) => Math.max(max, s.position), 0) + 1;
    const { error } = await supabaseClient.from("coach_sports").insert({
      user_id: user.id,
      slug: `custom-${crypto.randomUUID().slice(0, 8)}`,
      name: sport.name,
      icon: sport.icon,
      color: sport.color,
      has_distance: sport.hasDistance,
      position,
      is_default: false,
    });
    if (error) {
      console.error("Erreur d'ajout du sport :", error.message);
      return false;
    }
    await loadSports();
    return true;
  }

  async function updateSport(id, updates) {
    const { error } = await supabaseClient
      .from("coach_sports")
      .update({
        name: updates.name,
        icon: updates.icon,
        color: updates.color,
        has_distance: updates.hasDistance,
      })
      .eq("id", id);
    if (error) {
      console.error("Erreur de modification du sport :", error.message);
      return false;
    }
    await loadSports();
    return true;
  }

  async function setSportArchived(id, archived) {
    const { error } = await supabaseClient
      .from("coach_sports")
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) {
      console.error("Erreur d'archivage du sport :", error.message);
      return false;
    }
    await loadSports();
    return true;
  }

  return {
    refresh,
    getUserEmail,
    getSports,
    getArchivedSports,
    getSport,
    addSport,
    updateSport,
    setSportArchived,
  };
})();
