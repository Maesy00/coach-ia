/*
 * importers.js — lecture des fichiers Garmin et Strava, entièrement dans le
 * navigateur (aucun fichier n'est envoyé ailleurs) :
 *   .FIT (Garmin, via le SDK officiel @garmin/fitsdk), .GPX, .TCX,
 *   versions compressées .gz, et l'archive ZIP d'export complet de Strava
 *   (on lit son activities.csv, bien plus rapide que chaque fichier).
 *
 * Chaque fichier donne des « candidats » :
 *   { sport, date, startTime, durationMinutes, distanceKm, elevationM, avgHr, maxHr,
 *     title, source, externalId, fileName }
 * La durée retenue est le temps en mouvement (comme dans Aurora), pour que
 * le dédoublonnage compare des choses comparables.
 */

const Importers = (() => {
  const FIT_SDK = "https://cdn.jsdelivr.net/npm/@garmin/fitsdk@21.217.0/+esm";
  const JSZIP = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";

  // ---------------------------------------------------------------------
  // Type d'activité → sport de Coach.ia
  // ---------------------------------------------------------------------

  const TYPE_MAP = [
    { slug: "running", match: ["run", "course", "trail", "treadmill", "jogging"] },
    { slug: "cycling", match: ["ride", "bike", "biking", "cycling", "velo", "vtt", "gravel", "e_bike"] },
    { slug: "swimming", match: ["swim", "natation", "nage"] },
    { slug: "pilates", match: ["pilates"] },
    { slug: "yoga", match: ["yoga"] },
    { slug: "strength", match: ["weight", "strength", "muscu", "crossfit", "renforcement", "workout", "training", "entrainement"] },
  ];

  const normalize = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  // Les sports ajoutés à la main (ex. « Randonnée ») sont reconnus par leur nom.
  function mapType(raw) {
    const value = normalize(raw);
    if (!value) return null;
    const custom = Storage.getSports().find((s) => !s.isDefault && value.includes(normalize(s.name)));
    if (custom) return custom.slug;
    const found = TYPE_MAP.find((t) => t.match.some((m) => value.includes(m)));
    return found && Storage.getSport(found.slug) ? found.slug : null;
  }

  // ---------------------------------------------------------------------
  // Outils
  // ---------------------------------------------------------------------

  const round2 = (n) => Math.round(n * 100) / 100;
  const pad = (n) => String(n).padStart(2, "0");

  function localParts(date) {
    return { date: DateUtil.toISO(date), startTime: `${pad(date.getHours())}:${pad(date.getMinutes())}` };
  }

  function haversineKm(a, b) {
    const R = 6371;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // D+ avec un seuil de 2 m pour ignorer le bruit de l'altimètre.
  function elevationGain(altitudes) {
    let gain = 0;
    let ref = null;
    for (const alt of altitudes) {
      if (alt === null || isNaN(alt)) continue;
      if (ref === null) ref = alt;
      else if (alt - ref >= 2) {
        gain += alt - ref;
        ref = alt;
      } else if (alt < ref) ref = alt;
    }
    return gain;
  }

  async function gunzip(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Bibliothèque indisponible (connexion ?)"));
      document.head.appendChild(s);
    });
  }

  const xmlText = (parent, tag) => {
    const el = parent.getElementsByTagName(tag)[0];
    return el ? el.textContent.trim() : "";
  };

  // ---------------------------------------------------------------------
  // GPX
  // ---------------------------------------------------------------------

  function parseGPX(text, fileName) {
    const doc = new DOMParser().parseFromString(text, "application/xml");
    const gpx = doc.getElementsByTagName("gpx")[0];
    if (!gpx) throw new Error("GPX illisible");
    const creator = normalize(gpx.getAttribute("creator"));
    const trk = doc.getElementsByTagName("trk")[0];
    const rawType = trk ? xmlText(trk, "type") : "";
    const title = (trk && xmlText(trk, "name")) || xmlText(doc, "name");

    const points = [...doc.getElementsByTagName("trkpt")].map((p) => {
      const hrEl = [...p.getElementsByTagName("*")].find((el) => /(^|:)hr$/i.test(el.tagName));
      return {
        lat: Number(p.getAttribute("lat")),
        lon: Number(p.getAttribute("lon")),
        ele: p.getElementsByTagName("ele")[0] ? Number(p.getElementsByTagName("ele")[0].textContent) : null,
        time: p.getElementsByTagName("time")[0] ? new Date(p.getElementsByTagName("time")[0].textContent) : null,
        hr: hrEl ? Number(hrEl.textContent) : null,
      };
    });
    const timed = points.filter((p) => p.time && !isNaN(p.time));
    if (timed.length < 2) throw new Error("Pas de trace horodatée");

    let distance = 0;
    let moving = 0;
    for (let i = 1; i < timed.length; i++) {
      const d = haversineKm(timed[i - 1], timed[i]);
      const dt = (timed[i].time - timed[i - 1].time) / 1000;
      distance += d;
      // En mouvement si on avance à plus de 1,8 km/h, sans compter les longues pauses.
      if (dt > 0 && dt < 60 && (d * 1000) / dt > 0.5) moving += dt;
    }
    const elapsed = (timed[timed.length - 1].time - timed[0].time) / 1000;
    const hrs = points.map((p) => p.hr).filter((h) => h > 0);
    const sport = mapType(rawType) || mapType(title) || mapType(fileName);

    return [
      {
        sport,
        rawType: rawType || title,
        ...localParts(timed[0].time),
        durationMinutes: Math.round((moving || elapsed) / 60),
        distanceKm: distance > 0.05 ? round2(distance) : null,
        elevationM: Math.round(elevationGain(points.map((p) => p.ele))) || null,
        avgHr: hrs.length ? Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length) : null,
        maxHr: hrs.length ? Math.max(...hrs) : null,
        title: title || null,
        source: creator.includes("strava") ? "strava" : creator.includes("garmin") ? "garmin" : "gpx",
        externalId: null,
        fileName,
      },
    ];
  }

  // ---------------------------------------------------------------------
  // TCX
  // ---------------------------------------------------------------------

  function parseTCX(text, fileName) {
    const doc = new DOMParser().parseFromString(text.trim(), "application/xml");
    const activities = [...doc.getElementsByTagName("Activity")];
    if (!activities.length) throw new Error("TCX illisible");
    const creator = normalize(xmlText(doc, "Creator") || xmlText(doc, "Author"));

    return activities.map((act) => {
      const laps = [...act.getElementsByTagName("Lap")];
      const start = new Date(xmlText(act, "Id") || (laps[0] && laps[0].getAttribute("StartTime")));
      const seconds = laps.reduce((s, l) => s + Number(xmlText(l, "TotalTimeSeconds") || 0), 0);
      const meters = laps.reduce((s, l) => s + Number(xmlText(l, "DistanceMeters") || 0), 0);
      const avgs = laps.map((l) => Number(xmlText(l.getElementsByTagName("AverageHeartRateBpm")[0] || l, "Value"))).filter((v) => v > 0);
      const maxs = laps.map((l) => Number(xmlText(l.getElementsByTagName("MaximumHeartRateBpm")[0] || l, "Value"))).filter((v) => v > 0);
      const alts = [...act.getElementsByTagName("AltitudeMeters")].map((el) => Number(el.textContent));
      const rawType = act.getAttribute("Sport") || "";
      return {
        sport: mapType(rawType) || mapType(fileName),
        rawType,
        ...localParts(start),
        durationMinutes: Math.round(seconds / 60),
        distanceKm: meters > 50 ? round2(meters / 1000) : null,
        elevationM: Math.round(elevationGain(alts)) || null,
        avgHr: avgs.length ? Math.round(avgs.reduce((s, v) => s + v, 0) / avgs.length) : null,
        maxHr: maxs.length ? Math.max(...maxs) : null,
        title: null,
        source: creator.includes("strava") ? "strava" : "garmin",
        externalId: null,
        fileName,
      };
    });
  }

  // ---------------------------------------------------------------------
  // FIT (Garmin)
  // ---------------------------------------------------------------------

  let fitSdk = null;

  async function parseFIT(bytes, fileName) {
    if (!fitSdk) fitSdk = await import(FIT_SDK);
    const { Decoder, Stream } = fitSdk;
    const decoder = new Decoder(Stream.fromByteArray(bytes));
    if (!decoder.isFIT() || !decoder.checkIntegrity()) throw new Error("Fichier FIT invalide");
    const { messages } = decoder.read();
    const sessions = messages.sessionMesgs || [];
    if (!sessions.length) throw new Error("Aucune activité dans ce FIT");
    const fileId = (messages.fileIdMesgs || [])[0] || {};
    const manufacturer = normalize(fileId.manufacturer);

    return sessions.map((s, i) => {
      const start = new Date(s.startTime);
      const rawType = s.subSport && s.subSport !== "generic" ? `${s.sport} ${s.subSport}` : String(s.sport || "");
      return {
        sport: mapType(s.subSport === "strengthTraining" ? "strength" : rawType) || mapType(fileName),
        rawType,
        ...localParts(start),
        durationMinutes: Math.round((s.totalTimerTime || s.totalElapsedTime || 0) / 60),
        distanceKm: s.totalDistance > 50 ? round2(s.totalDistance / 1000) : null,
        elevationM: s.totalAscent ? Math.round(s.totalAscent) : null,
        avgHr: s.avgHeartRate || null,
        maxHr: s.maxHeartRate || null,
        title: null,
        source: manufacturer.includes("strava") ? "strava" : "garmin",
        externalId: `fit:${fileId.serialNumber || ""}:${start.toISOString()}:${i}`,
        fileName,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Strava : activities.csv de l'export complet
  // ---------------------------------------------------------------------

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (inQuotes) {
        if (char === '"' && text[i + 1] === '"') {
          field += '"';
          i++;
        } else if (char === '"') inQuotes = false;
        else field += char;
      } else if (char === '"') inQuotes = true;
      else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n" || char === "\r") {
        if (char === "\r" && text[i + 1] === "\n") i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += char;
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((c) => c !== ""));
  }

  const MONTHS = {
    jan: 0, janv: 0, janvier: 0, feb: 1, fev: 1, fevr: 1, fevrier: 1, mar: 2, mars: 2, apr: 3, avr: 3, avril: 3,
    may: 4, mai: 4, jun: 5, juin: 5, jul: 6, juil: 6, juillet: 6, aug: 7, aout: 7, sep: 8, sept: 8, septembre: 8,
    oct: 9, octobre: 9, nov: 10, novembre: 10, dec: 11, decembre: 11,
  };

  // Les dates de l'export Strava sont en UTC : « Mar 25, 2025, 5:32:10 PM » ou « 25 mars 2025, 17:32:10 ».
  function parseStravaDate(raw) {
    const s = normalize(raw).replace(/\./g, "");
    let m = s.match(/^([a-z]+) (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/);
    let day, month, year, hour, minute, second, ampm;
    if (m) [, month, day, year, hour, minute, second, ampm] = m;
    else {
      m = s.match(/^(\d{1,2}) ([a-z]+),? (\d{4}),? (?:a )?(\d{1,2})[:h](\d{2})(?::(\d{2}))?\s*(am|pm)?/);
      if (!m) return null;
      [, day, month, year, hour, minute, second, ampm] = m;
    }
    const monthIndex = MONTHS[month] ?? MONTHS[month.slice(0, 3)];
    if (monthIndex === undefined) return null;
    let h = Number(hour) % (ampm ? 12 : 24);
    if (ampm === "pm") h += 12;
    return new Date(Date.UTC(Number(year), monthIndex, Number(day), h, Number(minute), Number(second || 0)));
  }

  function parseStravaCSV(text, fileName) {
    const rows = parseCSV(text);
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => normalize(h).trim());
    const first = (...names) => headers.findIndex((h) => names.includes(h));
    const last = (...names) => {
      for (let i = headers.length - 1; i >= 0; i--) if (names.includes(headers[i])) return i;
      return -1;
    };
    const col = {
      id: first("activity id", "id de l'activite"),
      date: first("activity date", "date de l'activite"),
      name: first("activity name", "nom de l'activite"),
      type: first("activity type", "type d'activite"),
      elapsed: first("elapsed time", "temps ecoule"),
      moving: first("moving time", "temps de deplacement", "duree de deplacement"),
      distance: last("distance"),
      elevation: first("elevation gain", "denivele positif"),
      avgHr: first("average heart rate", "frequence cardiaque moyenne"),
      maxHr: first("max heart rate", "frequence cardiaque max", "frequence cardiaque maximale"),
    };
    if (col.date < 0 || col.type < 0) throw new Error("Ce CSV ne ressemble pas à un export Strava");
    const num = (row, i) => (i >= 0 && row[i] ? Number(String(row[i]).replace(",", ".")) : NaN);

    return rows.slice(1).flatMap((row) => {
      const start = parseStravaDate(row[col.date]);
      if (!start || isNaN(start)) return [];
      const seconds = num(row, col.moving) > 0 ? num(row, col.moving) : num(row, col.elapsed);
      const meters = num(row, col.distance);
      const rawType = row[col.type];
      return [
        {
          sport: mapType(rawType),
          rawType,
          ...localParts(start),
          durationMinutes: Math.round((seconds || 0) / 60),
          distanceKm: meters > 50 ? round2(meters / 1000) : null,
          elevationM: num(row, col.elevation) > 0 ? Math.round(num(row, col.elevation)) : null,
          avgHr: num(row, col.avgHr) > 0 ? Math.round(num(row, col.avgHr)) : null,
          maxHr: num(row, col.maxHr) > 0 ? Math.round(num(row, col.maxHr)) : null,
          title: col.name >= 0 ? row[col.name] || null : null,
          source: "strava",
          externalId: col.id >= 0 && row[col.id] ? `strava:${row[col.id]}` : null,
          fileName,
        },
      ];
    });
  }

  async function parseStravaZip(file, onProgress) {
    if (!window.JSZip) await loadScript(JSZIP);
    const zip = await JSZip.loadAsync(file);
    const csv = Object.values(zip.files).find((f) => /(^|\/)activities\.csv$/i.test(f.name));
    if (csv) return parseStravaCSV(await csv.async("string"), file.name);

    // Pas de activities.csv : on lit chaque fichier d'activité.
    const entries = Object.values(zip.files).filter((f) => !f.dir && /\.(fit|gpx|tcx)(\.gz)?$/i.test(f.name));
    const out = [];
    for (let i = 0; i < entries.length; i++) {
      onProgress && onProgress(i + 1, entries.length);
      try {
        out.push(...(await parseBytes(entries[i].name, await entries[i].async("uint8array"))));
      } catch (err) {
        console.warn(entries[i].name, err.message);
      }
    }
    return out.map((c) => ({ ...c, source: "strava" }));
  }

  // ---------------------------------------------------------------------
  // Point d'entrée
  // ---------------------------------------------------------------------

  async function parseBytes(name, bytes) {
    let lower = name.toLowerCase();
    if (lower.endsWith(".gz")) {
      bytes = await gunzip(bytes);
      lower = lower.slice(0, -3);
    }
    if (lower.endsWith(".fit")) return parseFIT(bytes, name);
    const text = new TextDecoder().decode(bytes);
    if (lower.endsWith(".gpx")) return parseGPX(text, name);
    if (lower.endsWith(".tcx")) return parseTCX(text, name);
    if (lower.endsWith(".csv")) return parseStravaCSV(text, name);
    throw new Error("Format non pris en charge");
  }

  // → { candidates, errors: [{ fileName, message }] }
  async function readFiles(files, onProgress) {
    const candidates = [];
    const errors = [];
    const list = [...files];
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      onProgress && onProgress(`Lecture de ${file.name}`, i + 1, list.length);
      try {
        if (/\.zip$/i.test(file.name)) {
          candidates.push(...(await parseStravaZip(file, (n, total) => onProgress && onProgress(`Archive Strava : ${n}/${total}`, i + 1, list.length))));
        } else {
          candidates.push(...(await parseBytes(file.name, new Uint8Array(await file.arrayBuffer()))));
        }
      } catch (err) {
        errors.push({ fileName: file.name, message: err.message });
      }
    }
    return { candidates: candidates.filter((c) => c.durationMinutes > 0), errors };
  }

  return { readFiles, mapType, parseGPX, parseTCX, parseFIT, parseStravaCSV, parseStravaDate };
})();
