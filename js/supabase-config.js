/*
 * supabase-config.js — connexion à la base de données en ligne.
 * Même projet Supabase qu'Aurora, Ironly et Pause (tables "coach_*") :
 * un seul compte pour toutes les apps. L'URL et la clé "anon" sont
 * publiques par design : la sécurité vient des règles RLS de Supabase
 * (chacun ne lit/écrit que ses propres données), pas du secret de la clé.
 */

const SUPABASE_URL = "https://eqydrejfdpusuvydcjdp.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVxeWRyZWpmZHB1c3V2eWRjamRwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczOTUyOTksImV4cCI6MjEwMjk3MTI5OX0.klBsvnYuG4U9sNZrOjkoYT22EOhMJy8qDuhQFIDf-lo";

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
