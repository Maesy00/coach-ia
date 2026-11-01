/*
 * auth.js — écran de connexion et gestion de la session Supabase.
 * Tant que personne n'est connecté, seul l'écran de connexion est
 * visible ; le reste de l'app (#app-shell) reste caché.
 * Même compte que pour Aurora, Ironly et Pause.
 */

const authGate = document.getElementById("auth-gate");
const appShell = document.getElementById("app-shell");
const authForm = document.getElementById("auth-form");
const authTitle = document.getElementById("auth-title");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const authInfo = document.getElementById("auth-info");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authToggleBtn = document.getElementById("auth-toggle-mode");
const authSwitchText = document.getElementById("auth-switch-text");

let authMode = "signin";
let appStarted = false;

function setAuthMode(mode) {
  authMode = mode;
  authError.hidden = true;
  authInfo.hidden = true;

  if (mode === "signin") {
    authTitle.textContent = "Connexion";
    authSubmitBtn.textContent = "Se connecter";
    authSwitchText.textContent = "Pas encore de compte ?";
    authToggleBtn.textContent = "Créer un compte";
    authPassword.autocomplete = "current-password";
  } else {
    authTitle.textContent = "Créer un compte";
    authSubmitBtn.textContent = "Créer mon compte";
    authSwitchText.textContent = "Déjà un compte ?";
    authToggleBtn.textContent = "Se connecter";
    authPassword.autocomplete = "new-password";
  }
}

authToggleBtn.addEventListener("click", () => {
  setAuthMode(authMode === "signin" ? "signup" : "signin");
});

async function showApp() {
  appStarted = true;
  authGate.hidden = true;
  appShell.hidden = false;
  const ok = await Storage.refresh();
  App.start();
  if (!ok) showToast("Base introuvable : lance supabase-setup.sql", "warning-circle");
}

function showAuthGate() {
  appStarted = false;
  authGate.hidden = false;
  appShell.hidden = true;
  authForm.reset();
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.hidden = true;
  authInfo.hidden = true;
  authSubmitBtn.disabled = true;

  const email = authEmail.value.trim();
  const password = authPassword.value;

  if (authMode === "signin") {
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      authError.textContent = "Email ou mot de passe incorrect.";
      authError.hidden = false;
    }
  } else {
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      authError.textContent = error.message;
      authError.hidden = false;
    } else if (!data.session) {
      authInfo.textContent = "Compte créé ! Vérifie ta boîte mail pour confirmer ton adresse, puis connecte-toi.";
      authInfo.hidden = false;
      setAuthMode("signin");
    }
  }

  authSubmitBtn.disabled = false;
});

// Le rafraîchissement automatique du jeton déclenche aussi cet événement :
// on ne relance l'app que si elle n'est pas déjà affichée.
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (session) {
    if (!appStarted) setTimeout(showApp, 0);
  } else {
    showAuthGate();
  }
});
