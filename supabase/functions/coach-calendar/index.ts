/*
 * coach-calendar — fonction Supabase (Edge Function) qui sert le calendrier
 * « Coach.ia » au format iCal, pour l'abonnement depuis l'iPhone :
 *   webcal://<projet>.supabase.co/functions/v1/coach-calendar?token=<lien secret>
 *
 * Le calendrier de l'iPhone ne peut pas se connecter : la vérification JWT
 * de cette fonction est désactivée, et c'est le lien secret qui donne accès
 * aux données, via la fonction SQL coach_calendar_feed (clé publique "anon").
 *
 * Déployée depuis le tableau de bord Supabase (Edge Functions → éditeur),
 * comme pause-calendar.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// Clé publique "anon" (la même que dans js/supabase-config.js), si l'environnement ne la fournit pas.
const ANON_KEY =
  Deno.env.get("SUPABASE_ANON_KEY") ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxeWRyZWpmZHB1c3V2eWRjamRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczOTUyOTksImV4cCI6MjEwMjk3MTI5OX0.klBsvnYuG4U9sNZrOjkoYT22EOhMJy8qDuhQFIDf-lo";

const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "https://eqydrejfdpusuvydcjdp.supabase.co", ANON_KEY);

const INTENSITY: Record<string, string> = {
  ef: "EF",
  tempo: "Tempo",
  seuil: "Seuil",
  fractionne: "Fractionné",
  vma: "VMA",
  sortie_longue: "Sortie longue",
  recup: "Récup",
};

type FeedRow = {
  id: string;
  date: string;
  start_time: string | null;
  duration_minutes: number;
  sport_name: string;
  intensity: string | null;
  notes: string | null;
  program_name: string | null;
  done: boolean;
};

function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

// Les lignes iCal ne doivent pas dépasser 75 octets : on les replie.
function fold(line: string): string {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let current = "";
  for (const char of line) {
    if (encoder.encode(current + char).length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.join("\r\n ");
}

const compactDate = (date: string) => date.replaceAll("-", "");
const pad = (n: number) => String(n).padStart(2, "0");

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// Heure locale « flottante » (sans fuseau) : l'iPhone l'affiche telle quelle.
function localStamp(date: string, time: string, addMinutes = 0): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(h * 60 + m + addMinutes);
  return `${d.toISOString().slice(0, 10).replaceAll("-", "")}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

function toIcs(rows: FeedRow[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Coach.ia//Séances//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Coach.ia",
    "X-WR-CALDESC:Séances prévues dans Coach.ia.",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];

  for (const row of rows) {
    const detail = row.program_name ?? (row.intensity ? INTENSITY[row.intensity] ?? row.intensity : null);
    const title = `${row.sport_name}${detail ? ` · ${detail}` : ""}${row.done ? " ✓" : ""}`;
    const description = [row.notes, row.done ? "Fait." : null].filter(Boolean).join("\n");

    lines.push("BEGIN:VEVENT", `UID:${row.id}@coach-ia`, `DTSTAMP:${stamp}`);
    if (row.start_time) {
      lines.push(`DTSTART:${localStamp(row.date, row.start_time)}`, `DTEND:${localStamp(row.date, row.start_time, row.duration_minutes || 60)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(row.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(row.date))}`, "TRANSP:TRANSPARENT");
    }
    lines.push(`SUMMARY:${escapeText(title)}`);
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{48}$/.test(token)) return new Response("Lien de calendrier invalide.", { status: 404 });

  const { data, error } = await supabase.rpc("coach_calendar_feed", { feed_token: token });
  if (error) return new Response("Calendrier indisponible.", { status: 500 });

  return new Response(toIcs(data as FeedRow[]), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="coach-ia.ics"',
      "Cache-Control": "no-store",
    },
  });
});
