/*
 * Storage.js — seul endroit qui lit/écrit les données de Coach.ia.
 * Parle à la base Supabase en ligne (tables coach_*, synchronisées entre
 * appareils). Comme dans Aurora et Pause, les getters restent synchrones :
 * ils lisent un cache local mis à jour après chaque appel réseau.
 *
 * Archivage : rien n'est effacé. « Supprimer » ou « Masquer » renseigne
 * archived_at, et les éléments archivés sont exclus de l'affichage.
 */

const Storage = (() => {
  // Correspondance champ JS → colonne Supabase, par type de donnée.
  const KINDS = {
    sports: {
      table: "coach_sports",
      fields: { slug: "slug", name: "name", icon: "icon", color: "color", hasDistance: "has_distance", position: "position", isDefault: "is_default" },
      order: [["position", true], ["created_at", true]],
      keepArchived: true,
    },
    customExercises: {
      table: "coach_custom_exercises",
      fields: { name: "name", group: "muscle_group", metric: "metric", legacyRef: "legacy_ref" },
      order: [["created_at", true]],
    },
    programs: {
      table: "coach_programs",
      fields: { name: "name", exercises: "exercises", legacyRef: "legacy_ref" },
      order: [["created_at", true]],
    },
    activities: {
      table: "coach_activities",
      fields: {
        sport: "sport", date: "date", startTime: "start_time", durationMinutes: "duration_minutes",
        distanceKm: "distance_km", elevationM: "elevation_m", avgHr: "avg_hr", maxHr: "max_hr", rpe: "rpe",
        title: "title", notes: "notes", source: "source", externalId: "external_id", details: "details", legacyRef: "legacy_ref",
      },
      order: [["date", false], ["start_time", false]],
    },
    planned: {
      table: "coach_planned",
      fields: {
        date: "date", startTime: "start_time", durationMinutes: "duration_minutes", sport: "sport", intensity: "intensity",
        notes: "notes", programId: "program_id", activityId: "activity_id", doneAt: "done_at", legacyRef: "legacy_ref",
      },
      order: [["date", true], ["start_time", true]],
    },
    templates: {
      table: "coach_week_templates",
      fields: { name: "name", sessions: "sessions" },
      order: [["created_at", true]],
    },
  };

  const NUMERIC = new Set(["duration_minutes", "distance_km", "elevation_m"]);
  const cache = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  let userId = null;
  let userEmail = "";
  let loadErrors = [];

  function fromRow(kind, row) {
    const obj = { id: row.id, archivedAt: row.archived_at || null, createdAt: row.created_at };
    for (const [key, col] of Object.entries(KINDS[kind].fields)) {
      let value = row[col];
      if (col === "start_time" && value) value = value.slice(0, 5);
      if (NUMERIC.has(col) && value !== null && value !== undefined) value = Number(value);
      obj[key] = value;
    }
    return obj;
  }

  // Ne convertit que les champs présents : sert aussi aux mises à jour partielles.
  function toRow(kind, obj) {
    const row = {};
    for (const [key, col] of Object.entries(KINDS[kind].fields)) {
      if (obj[key] !== undefined) row[col] = obj[key] === "" && col !== "notes" ? null : obj[key];
    }
    return row;
  }

  function sortCache(kind) {
    const { order } = KINDS[kind];
    const fields = Object.entries(KINDS[kind].fields);
    const keyOf = (col) => (col === "created_at" ? "createdAt" : fields.find(([, c]) => c === col)[0]);
    cache[kind].sort((a, b) => {
      for (const [col, asc] of order) {
        const k = keyOf(col);
        const va = a[k] ?? "";
        const vb = b[k] ?? "";
        if (va < vb) return asc ? -1 : 1;
        if (va > vb) return asc ? 1 : -1;
      }
      return 0;
    });
  }

  // Supabase renvoie 1000 lignes au plus par requête : on pagine.
  async function fetchAll(kind) {
    const { table, order, keepArchived } = KINDS[kind];
    const rows = [];
    for (let from = 0; ; from += 1000) {
      let query = supabaseClient.from(table).select("*");
      if (!keepArchived) query = query.is("archived_at", null);
      order.forEach(([col, asc]) => (query = query.order(col, { ascending: asc, nullsFirst: false })));
      const { data, error } = await query.range(from, from + 999);
      if (error) throw new Error(`${table} : ${error.message}`);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows.map((r) => fromRow(kind, r));
  }

  async function load(kind) {
    try {
      cache[kind] = await fetchAll(kind);
      return true;
    } catch (err) {
      console.error("Erreur de chargement :", err.message);
      loadErrors.push(err.message);
      return false;
    }
  }

  // Crée les sports par défaut qui manquent. Un sport par défaut masqué
  // reste masqué : le conflit sur (user_id, slug) est simplement ignoré.
  async function ensureDefaultSports() {
    const known = new Set(cache.sports.map((s) => s.slug));
    const missing = DEFAULT_SPORTS.filter((s) => !known.has(s.slug));
    if (!missing.length) return;
    const rows = missing.map((s) => ({
      user_id: userId,
      ...toRow("sports", { ...s, position: DEFAULT_SPORTS.indexOf(s), isDefault: true }),
    }));
    const { error } = await supabaseClient.from("coach_sports").upsert(rows, { onConflict: "user_id,slug", ignoreDuplicates: true });
    if (error) console.error("Erreur de création des sports par défaut :", error.message);
    else await load("sports");
  }

  async function refresh() {
    const {
      data: { user },
    } = await supabaseClient.auth.getUser();
    userId = user ? user.id : null;
    userEmail = user ? user.email : "";
    loadErrors = [];
    const results = await Promise.all(Object.keys(KINDS).map(load));
    if (results[0] && userId) await ensureDefaultSports();
    return results.every(Boolean);
  }

  // ---- Écritures génériques (le cache est mis à jour sans tout recharger) ----

  async function insert(kind, obj) {
    const { data, error } = await supabaseClient
      .from(KINDS[kind].table)
      .insert({ user_id: userId, ...toRow(kind, obj) })
      .select()
      .single();
    if (error) {
      console.error(`Erreur d'enregistrement (${kind}) :`, error.message);
      return null;
    }
    const created = fromRow(kind, data);
    cache[kind].push(created);
    sortCache(kind);
    return created;
  }

  // Insertion en lot ; les lignes déjà présentes (même legacy_ref) sont ignorées.
  async function insertMany(kind, objs, { ignoreLegacyDuplicates = false } = {}) {
    let count = 0;
    for (let i = 0; i < objs.length; i += 300) {
      const rows = objs.slice(i, i + 300).map((o) => ({ user_id: userId, ...toRow(kind, o) }));
      const query = ignoreLegacyDuplicates
        ? supabaseClient.from(KINDS[kind].table).upsert(rows, { onConflict: "user_id,legacy_ref", ignoreDuplicates: true }).select()
        : supabaseClient.from(KINDS[kind].table).insert(rows).select();
      const { data, error } = await query;
      if (error) {
        console.error(`Erreur d'enregistrement en lot (${kind}) :`, error.message);
        throw new Error(error.message);
      }
      data.forEach((r) => cache[kind].push(fromRow(kind, r)));
      count += data.length;
    }
    sortCache(kind);
    return count;
  }

  async function update(kind, id, changes) {
    const { data, error } = await supabaseClient.from(KINDS[kind].table).update(toRow(kind, changes)).eq("id", id).select().single();
    if (error) {
      console.error(`Erreur de modification (${kind}) :`, error.message);
      return null;
    }
    const updated = fromRow(kind, data);
    const index = cache[kind].findIndex((x) => x.id === id);
    if (index >= 0) cache[kind][index] = updated;
    sortCache(kind);
    return updated;
  }

  async function setArchived(kind, id, archived) {
    const { data, error } = await supabaseClient
      .from(KINDS[kind].table)
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq("id", id)
      .select()
      .single();
    if (error) {
      console.error(`Erreur d'archivage (${kind}) :`, error.message);
      return false;
    }
    if (KINDS[kind].keepArchived) {
      const index = cache[kind].findIndex((x) => x.id === id);
      cache[kind][index] = fromRow(kind, data);
    } else {
      cache[kind] = cache[kind].filter((x) => x.id !== id);
    }
    return true;
  }

  // ---- Compte ----

  function getUserEmail() {
    return userEmail;
  }

  function getLoadErrors() {
    return loadErrors;
  }

  // ---- Sports ----

  function getSports() {
    return cache.sports.filter((s) => !s.archivedAt);
  }

  function getArchivedSports() {
    return cache.sports.filter((s) => s.archivedAt);
  }

  // Par id ou par slug ; un sport inconnu (supprimé, importé) reçoit une apparence neutre.
  function getSport(idOrSlug) {
    return cache.sports.find((s) => s.id === idOrSlug || s.slug === idOrSlug) || null;
  }

  function sportOrFallback(slug) {
    return getSport(slug) || { slug, name: slug || "Autre", icon: "lightning", color: "#8c9bb0", hasDistance: false };
  }

  function addSport(sport) {
    const position = cache.sports.reduce((max, s) => Math.max(max, s.position), 0) + 1;
    return insert("sports", { ...sport, slug: sport.slug || `custom-${crypto.randomUUID().slice(0, 8)}`, position, isDefault: false });
  }

  // ---- Calendrier : lien secret d'abonnement ----

  async function getCalendarToken() {
    const { data, error } = await supabaseClient.from("coach_calendar_tokens").select("token").eq("user_id", userId).maybeSingle();
    if (error) {
      console.error("Erreur du lien de calendrier :", error.message);
      return null;
    }
    if (data) return data.token;
    const created = await supabaseClient.from("coach_calendar_tokens").insert({ user_id: userId }).select("token").single();
    return created.error ? null : created.data.token;
  }

  async function resetCalendarToken() {
    const { error } = await supabaseClient.from("coach_calendar_tokens").delete().eq("user_id", userId);
    if (error) return null;
    return getCalendarToken();
  }

  return {
    refresh,
    getUserEmail,
    getLoadErrors,
    insert,
    insertMany,
    update,
    setArchived,

    getSports,
    getArchivedSports,
    getSport,
    sportOrFallback,
    addSport,
    updateSport: (id, changes) => update("sports", id, changes),
    setSportArchived: (id, archived) => setArchived("sports", id, archived),

    getCustomExercises: () => cache.customExercises,
    getPrograms: () => cache.programs,
    getProgram: (id) => cache.programs.find((p) => p.id === id) || null,
    getActivities: () => cache.activities,
    getActivity: (id) => cache.activities.find((a) => a.id === id) || null,
    getPlanned: () => cache.planned,
    getTemplates: () => cache.templates,

    getCalendarToken,
    resetCalendarToken,
  };
})();
