/* PlantApp cloud — konto + synchronizacja multi-device (Supabase).
   Offline-first: localStorage jest źródłem prawdy na urządzeniu,
   chmura to replika scalana per-roślina po updated_at (last-write-wins). */
"use strict";

(function () {
  const cfg = window.PA_CONFIG || {};
  const cardBody = document.querySelector("#cloud-card-body");
  if (!cardBody) return;

  let user = null;
  let sb = null;
  let settings = { apiKey: "" };
  let settingsLoaded = false;
  let settingsError = "";
  const hasPlantNetProxy = !!cfg.PLANTNET_EDGE_FUNCTION_URL;

  function emitSettings() {
    window.dispatchEvent(new CustomEvent("pa:settings", { detail: {
      loaded: settingsLoaded,
      error: settingsError,
      hasApiKey: !!settings.apiKey,
      hasPlantNetProxy,
      hasPlantNetAccess: hasPlantNetProxy || !!settings.apiKey,
    } }));
  }

  function requireUser() {
    if (!user) throw new Error("Zaloguj się, żeby zapisać i pobrać klucz Pl@ntNet z chmury.");
  }

  async function loadSettings() {
    settingsLoaded = false;
    settingsError = "";
    emitSettings();
    if (!sb || !user) {
      settings = { apiKey: "" };
      settingsLoaded = true;
      emitSettings();
      return settings;
    }
    const { data, error } = await sb.from("user_settings").select("data").eq("user_id", user.id).maybeSingle();
    if (error) {
      settingsError = "Nie udało się pobrać ustawień: " + error.message;
      settingsLoaded = true;
      emitSettings();
      throw error;
    }
    settings = { apiKey: data?.data?.apiKey || "" };
    settingsLoaded = true;
    emitSettings();
    return settings;
  }

  async function saveSettings(next) {
    requireUser();
    settings = { ...settings, ...next };
    settingsLoaded = true;
    settingsError = "";
    emitSettings();
    const { error } = await sb.from("user_settings").upsert({
      user_id: user.id,
      data: settings,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) {
      settingsError = "Nie udało się zapisać ustawień: " + error.message;
      emitSettings();
      throw error;
    }
    emitSettings();
    return settings;
  }

  async function plantNetFetch(path, formData, params = {}) {
    if (hasPlantNetProxy) {
      const proxy = new URL(cfg.PLANTNET_EDGE_FUNCTION_URL, window.location.origin);
      proxy.searchParams.set("path", path);
      Object.entries(params).forEach(([key, value]) => proxy.searchParams.set(key, String(value)));
      return fetch(proxy.toString(), { method: "POST", body: formData });
    }
    if (!settingsLoaded) await loadSettings();
    if (!settings.apiKey) throw new Error("Brak klucza Pl@ntNet w chmurze — dodaj go w Ustawieniach.");
    const url = new URL(`https://my-api.plantnet.org/v2/${path}`);
    url.searchParams.set("api-key", settings.apiKey);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return fetch(url.toString(), { method: "POST", body: formData });
  }

  window.PlantAppCloud = {
    isConfigured: () => !!sb,
    isSettingsLoaded: () => settingsLoaded,
    getSettingsError: () => settingsError,
    hasPlantNetProxy: () => hasPlantNetProxy,
    hasPlantNetAccess: () => hasPlantNetProxy || !!settings.apiKey,
    hasPlantNetApiKey: () => !!settings.apiKey,
    getPlantNetApiKey: async () => {
      if (!settingsLoaded) await loadSettings();
      return settings.apiKey;
    },
    savePlantNetApiKey: async (apiKey) => saveSettings({ apiKey }),
    identifyPlant: (formData, { organ = "auto", lang = "pl", nbResults = 4 } = {}) =>
      plantNetFetch("identify/all", formData, { lang, "nb-results": nbResults, organs: organ }),
    identifyDisease: (formData, { nbResults = 3 } = {}) =>
      plantNetFetch("diseases/identify", formData, { "nb-results": nbResults }),
  };

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    settingsLoaded = true;
    settingsError = "Backend nieskonfigurowany.";
    emitSettings();
    cardBody.innerHTML = `<p class="muted">Backend nieskonfigurowany. Uruchom <code>node setup-supabase.mjs</code> z repo i wgraj wygenerowany <code>config.js</code>.</p>`;
    return;
  }

  sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const authScreen = document.querySelector("#view-auth");

  function showAuthScreen(show) {
    if (!authScreen) return;
    authScreen.classList.toggle("hidden", !show);
    document.body.classList.toggle("auth-open", show);
  }
  function wireAuthScreen() {
    if (!authScreen || authScreen.dataset.wired) return;
    authScreen.dataset.wired = "1";
    const msg = authScreen.querySelector("#au-msg");
    const act = async (kind) => {
      const email = authScreen.querySelector("#au-email").value.trim();
      const pass = authScreen.querySelector("#au-pass").value;
      if (!email || pass.length < 6) { msg.textContent = "Podaj e-mail i hasło (min. 6 znaków)."; return; }
      msg.textContent = "…";
      const { error } = kind === "signUp"
        ? await sb.auth.signUp({ email, password: pass })
        : await sb.auth.signInWithPassword({ email, password: pass });
      if (error) msg.textContent = ({
        "Invalid login credentials": "Błędny e-mail lub hasło.",
        "User already registered": "Konto już istnieje — kliknij „Zaloguj się”.",
      })[error.message] || error.message;
    };
    authScreen.querySelector("#au-login").onclick = () => act("signIn");
    authScreen.querySelector("#au-signup").onclick = () => act("signUp");
    authScreen.querySelector("#au-skip").onclick = () => {
      localStorage.setItem("pa_skipauth", "1");
      showAuthScreen(false);
    };
  }
  let pushTimer = null;
  let lastPull = 0;

  const tombs = {
    get list() { return JSON.parse(localStorage.getItem("pa_tombstones") || "[]"); },
    add(id) { const l = this.list; if (!l.includes(id)) { l.push(id); localStorage.setItem("pa_tombstones", JSON.stringify(l)); } },
    clear() { localStorage.removeItem("pa_tombstones"); },
  };

  function setStatus(msg, err) {
    const el = document.querySelector("#sync-status");
    if (el) { el.textContent = msg; el.classList.toggle("usage-low", !!err); }
  }

  // ---------- UI ----------
  function renderCloudUI() {
    if (!user) {
      cardBody.innerHTML = `
        <p class="muted">Konto = kopia w chmurze i te same rośliny na każdym urządzeniu.</p>
        <div class="row"><input type="email" id="cl-email" placeholder="E-mail" autocomplete="email"></div>
        <div class="row"><input type="password" id="cl-pass" placeholder="Hasło (min. 6 znaków)" autocomplete="current-password"></div>
        <div class="row">
          <button class="btn btn-primary" id="cl-login">Zaloguj</button>
          <button class="btn btn-ghost" id="cl-signup">Załóż konto</button>
        </div>
        <div id="cl-msg" class="muted small"></div>`;
      document.querySelector("#cl-login").onclick = () => authAction("signIn");
      document.querySelector("#cl-signup").onclick = () => authAction("signUp");
    } else {
      cardBody.innerHTML = `
        <p class="muted">Zalogowano: <strong>${user.email}</strong></p>
        <div id="sync-status" class="muted small">—</div>
        <div class="row">
          <button class="btn btn-primary" id="cl-sync">🔄 Synchronizuj teraz</button>
          <button class="btn btn-ghost" id="cl-logout">Wyloguj</button>
        </div>`;
      document.querySelector("#cl-sync").onclick = () => fullSync(true);
      document.querySelector("#cl-logout").onclick = async () => { await sb.auth.signOut(); };
    }
  }

  async function authAction(kind) {
    const email = document.querySelector("#cl-email").value.trim();
    const pass = document.querySelector("#cl-pass").value;
    const msg = document.querySelector("#cl-msg");
    if (!email || pass.length < 6) { msg.textContent = "Podaj e-mail i hasło (min. 6 znaków)."; return; }
    msg.textContent = "…";
    const { error } = kind === "signUp"
      ? await sb.auth.signUp({ email, password: pass })
      : await sb.auth.signInWithPassword({ email, password: pass });
    if (error) {
      msg.textContent = ({
        "Invalid login credentials": "Błędny e-mail lub hasło.",
        "User already registered": "Konto już istnieje — użyj „Zaloguj”.",
      })[error.message] || error.message;
    }
  }

  // ---------- SYNC ----------
  function localPlants() { return JSON.parse(localStorage.getItem("pa_plants") || "[]"); }
  function saveLocal(plants) { localStorage.setItem("pa_plants", JSON.stringify(plants)); if (typeof renderPlants === "function") renderPlants(); }

  async function pushAll() {
    if (!user) return;
    const plants = localPlants();
    const rows = plants.map(p => ({
      id: p.id,
      user_id: user.id,
      data: p,
      updated_at: new Date(p.updatedAt || p.added || Date.now()).toISOString(),
    }));
    tombs.list.forEach(id => rows.push({ id, user_id: user.id, data: { deleted: true }, updated_at: new Date().toISOString() }));
    if (!rows.length) return;
    const { error } = await sb.from("plants").upsert(rows, { onConflict: "id" });
    if (error) { setStatus("Błąd wysyłki: " + error.message, true); return; }
    tombs.clear();
    setStatus("Zsynchronizowano: " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
  }

  async function pullMerge() {
    if (!user) return;
    const { data: rows, error } = await sb.from("plants").select("id,data,updated_at");
    if (error) { setStatus("Błąd pobierania: " + error.message, true); return; }
    lastPull = Date.now();
    const local = localPlants();
    const byId = Object.fromEntries(local.map(p => [p.id, p]));
    let changed = false;
    const deadHere = new Set(tombs.list);

    for (const row of rows || []) {
      const remoteT = new Date(row.updated_at).getTime();
      const mine = byId[row.id];
      const mineT = mine ? (mine.updatedAt || mine.added || 0) : 0;
      if (row.data && row.data.deleted) {
        if (mine && mineT <= remoteT) { delete byId[row.id]; changed = true; }
        continue;
      }
      if (deadHere.has(row.id)) continue; // lokalnie usunięta, tombstone poleci przy push
      if (!mine || remoteT > mineT) { byId[row.id] = row.data; changed = true; }
    }
    if (changed) saveLocal(Object.values(byId));
  }

  async function fullSync(manual) {
    if (!user) return;
    setStatus(manual ? "Synchronizuję…" : "…");
    await Promise.all([pullMerge(), loadSettings().catch(() => null)]);
    await pushAll();
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushAll, 4000);
  }

  // ---------- ZDARZENIA ----------
  window.addEventListener("pa:change", schedulePush);
  window.addEventListener("pa:delete", (e) => { tombs.add(e.detail); schedulePush(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && user && Date.now() - lastPull > 5 * 60000) fullSync(false);
  });
  window.addEventListener("online", () => { if (user) fullSync(false); });

  sb.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    settings = { apiKey: "" };
    settingsLoaded = false;
    settingsError = "";
    emitSettings();
    renderCloudUI();
    if (user) { showAuthScreen(false); fullSync(false); }
    else {
      settingsLoaded = true;
      emitSettings();
      if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
    }
  });

  wireAuthScreen();
  renderCloudUI();
  // pierwsze wejście bez sesji → onboarding (onAuthStateChange INITIAL_SESSION też to złapie)
  if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
})();
