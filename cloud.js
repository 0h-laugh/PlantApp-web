/* PlantApp cloud — konto + synchronizacja multi-device (Supabase).
   Offline-first: localStorage jest źródłem prawdy na urządzeniu,
   chmura to replika scalana per-roślina po updated_at (merge-aware, per journal entry where possible). */
"use strict";

(function () {
  const cfg = window.PA_CONFIG || {};
  const cardBody = document.querySelector("#cloud-card-body");
  if (!cardBody) return;

  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    cardBody.innerHTML = `<p class="muted">Backend nieskonfigurowany. Uruchom <code>node setup-supabase.mjs</code> z repo i wgraj wygenerowany <code>config.js</code>.</p>`;
    return;
  }

  const sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  let user = null;
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
    add(item) {
      const obj = typeof item === "string" ? { id: item, userId: user?.id || null, homeId: null } : item;
      if (!obj?.id) return;
      const l = this.list.filter(x => (typeof x === "string" ? x : x.id) !== obj.id);
      l.push({ ...obj, deletedAt: Date.now() });
      localStorage.setItem("pa_tombstones", JSON.stringify(l));
    },
    clear() { localStorage.removeItem("pa_tombstones"); },
  };

  function setStatus(msg, err) {
    const el = document.querySelector("#sync-status");
    if (el) { el.textContent = msg; el.classList.toggle("usage-low", !!err); }
    if (user) localStorage.setItem("pa_last_cloud_sync_" + user.id, String(Date.now()));
  }

  // ---------- CLOUD SETTINGS / PLANTNET ----------
  let settingsLoaded = false;
  let userSettings = {};
  function emitUser() {
    window.PA_USER = user ? { id: user.id, email: user.email, displayName: user.email?.split("@")[0] || user.email } : null;
    window.dispatchEvent(new CustomEvent("pa:user", { detail: window.PA_USER }));
  }
  function emitSettings() { window.dispatchEvent(new CustomEvent("pa:settings", { detail: userSettings })); }
  async function loadSettings() {
    if (!user) { settingsLoaded = true; userSettings = {}; emitSettings(); return userSettings; }
    const { data, error } = await sb.from("user_settings").select("settings").eq("user_id", user.id).maybeSingle();
    if (!error && data?.settings) userSettings = data.settings;
    else if (error && !/relation .*user_settings/i.test(error.message)) setStatus("Błąd ustawień: " + error.message, true);
    settingsLoaded = true;
    emitSettings();
    return userSettings;
  }
  async function saveSettings(next) {
    userSettings = { ...userSettings, ...next };
    if (user) {
      const { error } = await sb.from("user_settings").upsert({ user_id: user.id, settings: userSettings, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      if (error) setStatus("Błąd zapisu ustawień: " + error.message, true);
    } else if (next.plantNetApiKey !== undefined) localStorage.setItem("pa_apikey", next.plantNetApiKey || "");
    emitSettings();
  }
  async function getPlantNetApiKey() {
    if (user && !settingsLoaded) await loadSettings();
    return userSettings.plantNetApiKey || localStorage.getItem("pa_apikey") || "";
  }
  async function savePlantNetApiKey(key) { await saveSettings({ plantNetApiKey: key }); }
  async function plantNetFetch(kind, formData) {
    const edge = cfg.PLANTNET_EDGE_FUNCTION_URL;
    if (edge) {
      const res = await fetch(edge, { method: "POST", headers: { "x-plantapp-kind": kind }, body: formData });
      return { res, data: await res.clone().json().catch(() => null) };
    }
    const key = await getPlantNetApiKey();
    const endpoint = kind === "disease" ? "diseases/identify" : "identify/all";
    const extra = kind === "disease" ? "&nb-results=3" : "&lang=pl&nb-results=4";
    const res = await fetch(`https://my-api.plantnet.org/v2/${endpoint}?api-key=${encodeURIComponent(key)}${extra}`, { method: "POST", body: formData });
    return { res, data: await res.clone().json().catch(() => null) };
  }
  window.PlantAppCloud = {
    getPlantNetApiKey,
    savePlantNetApiKey,
    identifyPlant: (formData) => plantNetFetch("identify", formData),
    identifyDisease: (formData) => plantNetFetch("disease", formData),
    fullSync: (manual = true) => fullSync(manual),
  };
  function journalKey(entry = {}) { return entry.id || [entry.type, entry.t, entry.name || entry.title || entry.text || ""].join(":"); }
  function mergeJournal(a = [], b = []) {
    const byKey = new Map();
    [...a, ...b].forEach(entry => {
      const key = journalKey(entry);
      const prev = byKey.get(key);
      if (!prev || (entry.updatedAt || entry.t || 0) >= (prev.updatedAt || prev.t || 0)) byKey.set(key, entry);
    });
    return [...byKey.values()].sort((x, y) => (x.t || 0) - (y.t || 0));
  }
  function mergePlantData(localPlant, remotePlant, remoteT) {
    if (!localPlant) return remotePlant;
    const localT = localPlant.updatedAt || localPlant.added || 0;
    const base = remoteT > localT ? { ...localPlant, ...remotePlant } : { ...remotePlant, ...localPlant };
    base.journal = mergeJournal(localPlant.journal || [], remotePlant.journal || []);
    const waters = base.journal.filter(e => e.type === "water").map(e => e.t || 0);
    const ferts = base.journal.filter(e => e.type === "fert").map(e => e.t || 0);
    if (waters.length) base.lastWatered = Math.max(...waters, base.lastWatered || 0);
    if (ferts.length) base.lastFertilized = Math.max(...ferts, base.lastFertilized || 0);
    base.updatedAt = Math.max(localT, remoteT, ...base.journal.map(e => e.updatedAt || e.t || 0));
    base.homeId = base.homeId || remotePlant.homeId;
    base.roomId = base.roomId || remotePlant.roomId;
    return base;
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
        <div id="sync-status" class="muted small">Ostatnia synchronizacja: ${localStorage.getItem("pa_last_cloud_sync_" + user.id) ? new Date(Number(localStorage.getItem("pa_last_cloud_sync_" + user.id))).toLocaleString("pl-PL") : "jeszcze brak"}</div>
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
  function localHomes() { return JSON.parse(localStorage.getItem("pa_homes") || "[]"); }
  function localRooms() { return JSON.parse(localStorage.getItem("pa_rooms") || "[]"); }
  function saveLocal(plants) {
    localStorage.setItem("pa_plants", JSON.stringify(plants));
    if (typeof ensureDefaultPlace === "function") ensureDefaultPlace();
    if (typeof renderPlants === "function") renderPlants();
  }
  function saveLocalPlaces(homes, rooms) {
    localStorage.setItem("pa_homes", JSON.stringify(homes));
    localStorage.setItem("pa_rooms", JSON.stringify(rooms));
    if (typeof ensureDefaultPlace === "function") ensureDefaultPlace();
  }

  async function pushAll() {
    if (!user) return;
    if (typeof ensureDefaultPlace === "function") ensureDefaultPlace();
    const homes = localHomes().map(h => ({
      id: h.id,
      owner_id: user.id,
      name: h.name || "Mój dom",
      address: h.address || null,
      created_at: new Date(h.createdAt || h.updatedAt || Date.now()).toISOString(),
      updated_at: new Date(h.updatedAt || h.createdAt || Date.now()).toISOString(),
    }));
    if (homes.length) {
      const { error } = await sb.from("homes").upsert(homes, { onConflict: "id" });
      if (error) { setStatus("Błąd wysyłki miejsc: " + error.message, true); return; }
    }
    const rooms = localRooms().map(r => ({
      id: r.id,
      home_id: r.homeId,
      name: r.name || "Bez pokoju",
      sort_order: r.sortOrder || 0,
      created_at: new Date(r.createdAt || r.updatedAt || Date.now()).toISOString(),
      updated_at: new Date(r.updatedAt || r.createdAt || Date.now()).toISOString(),
    }));
    if (rooms.length) {
      const { error } = await sb.from("rooms").upsert(rooms, { onConflict: "id" });
      if (error) { setStatus("Błąd wysyłki pokoi: " + error.message, true); return; }
    }
    const plants = localPlants();
    const rows = plants.map(p => ({
      id: p.id,
      user_id: user.id,
      home_id: p.homeId || null,
      room_id: p.roomId || null,
      data: p,
      updated_at: new Date(p.updatedAt || p.added || Date.now()).toISOString(),
    }));
    tombs.list.forEach(t => {
      const id = typeof t === "string" ? t : t.id;
      rows.push({ id, user_id: (typeof t === "object" && t.userId) || user.id, home_id: (typeof t === "object" && t.homeId) || null, data: { deleted: true }, updated_at: new Date((typeof t === "object" && t.deletedAt) || Date.now()).toISOString() });
    });
    if (!rows.length && !homes.length && !rooms.length) return;
    const { error } = rows.length ? await sb.from("plants").upsert(rows, { onConflict: "id" }) : { error: null };
    if (error) { setStatus("Błąd wysyłki roślin: " + error.message, true); return; }
    const journalRows = [];
    const photoRows = [];
    plants.forEach(p => (p.journal || []).forEach(e => {
      const entryId = e.id || `${p.id}_${e.t}_${e.type}`;
      journalRows.push({ id: entryId, plant_id: p.id, home_id: p.homeId || null, entry: e, updated_at: new Date(e.updatedAt || e.t || p.updatedAt || Date.now()).toISOString(), updated_by: e.userId || null });
      const photos = Array.isArray(e.photos) ? e.photos : (e.photo ? [e.photo] : []);
      photos.filter(Boolean).forEach((photo, index) => photoRows.push({ id: `${entryId}_${index}`, plant_id: p.id, home_id: p.homeId || null, kind: e.type || "journal", data_url: photo, updated_at: new Date(e.updatedAt || e.t || Date.now()).toISOString(), updated_by: e.userId || null }));
    }));
    if (journalRows.length) {
      const { error: journalError } = await sb.from("plant_journal_entries").upsert(journalRows, { onConflict: "id" });
      if (journalError && !/relation .*plant_journal_entries/i.test(journalError.message)) setStatus("Błąd dziennika: " + journalError.message, true);
    }
    if (photoRows.length) {
      const { error: photoError } = await sb.from("plant_photos").upsert(photoRows, { onConflict: "id" });
      if (photoError && !/relation .*plant_photos/i.test(photoError.message)) setStatus("Błąd zdjęć: " + photoError.message, true);
    }
    tombs.clear();
    setStatus("Zsynchronizowano: " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
  }

  async function pullMerge() {
    if (!user) return;
    const { data: homeRows, error: homesError } = await sb.from("homes").select("id,name,address,created_at,updated_at");
    if (homesError) { setStatus("Błąd pobierania miejsc: " + homesError.message, true); return; }
    const { data: roomRows, error: roomsError } = await sb.from("rooms").select("id,home_id,name,sort_order,created_at,updated_at");
    if (roomsError) { setStatus("Błąd pobierania pokoi: " + roomsError.message, true); return; }
    const { data: rows, error } = await sb.from("plants").select("id,home_id,room_id,data,updated_at");
    if (error) { setStatus("Błąd pobierania roślin: " + error.message, true); return; }
    lastPull = Date.now();

    const homesById = Object.fromEntries(localHomes().map(h => [h.id, h]));
    for (const row of homeRows || []) {
      const remoteT = new Date(row.updated_at).getTime();
      const mine = homesById[row.id];
      const mineT = mine ? (mine.updatedAt || mine.createdAt || 0) : 0;
      if (!mine || remoteT > mineT) homesById[row.id] = { id: row.id, name: row.name, address: row.address || "", createdAt: new Date(row.created_at).getTime(), updatedAt: remoteT };
    }
    const roomsById = Object.fromEntries(localRooms().map(r => [r.id, r]));
    for (const row of roomRows || []) {
      const remoteT = new Date(row.updated_at).getTime();
      const mine = roomsById[row.id];
      const mineT = mine ? (mine.updatedAt || mine.createdAt || 0) : 0;
      if (!mine || remoteT > mineT) roomsById[row.id] = { id: row.id, homeId: row.home_id, name: row.name, sortOrder: row.sort_order || 0, createdAt: new Date(row.created_at).getTime(), updatedAt: remoteT };
    }
    saveLocalPlaces(Object.values(homesById), Object.values(roomsById));

    const local = localPlants();
    const byId = Object.fromEntries(local.map(p => [p.id, p]));
    let changed = false;
    const deadHere = new Set(tombs.list.map(t => typeof t === "string" ? t : t.id));

    for (const row of rows || []) {
      const remoteT = new Date(row.updated_at).getTime();
      const mine = byId[row.id];
      const mineT = mine ? (mine.updatedAt || mine.added || 0) : 0;
      if (row.data && row.data.deleted) {
        if (mine && mineT <= remoteT) { delete byId[row.id]; changed = true; }
        continue;
      }
      if (deadHere.has(row.id)) continue; // lokalnie usunięta, tombstone poleci przy push
      const remotePlant = { ...row.data, homeId: row.data?.homeId || row.home_id || "", roomId: row.data?.roomId || row.room_id || "" };
      const merged = mergePlantData(mine, remotePlant, remoteT);
      if (!mine || JSON.stringify(merged) !== JSON.stringify(mine)) {
        byId[row.id] = merged;
        changed = true;
      }
    }
    if (changed) saveLocal(Object.values(byId));
  }

  async function fullSync(manual) {
    if (!user) return;
    setStatus(manual ? "Synchronizuję…" : "…");
    await loadSettings();
    await pullMerge();
    await pushAll();
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => fullSync(false), 4000);
  }


  async function createInvite(email) {
    if (!user) throw new Error("Zaloguj się, aby zapraszać.");
    const homeId = localStorage.getItem("pa_current_home");
    const token = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
    const { error } = await sb.from("home_invites").insert({ token, home_id: homeId, email, invited_by: user.id, status: "pending" });
    if (error) throw error;
    return token;
  }
  async function acceptInvite(token) {
    if (!user) throw new Error("Zaloguj się, aby przyjąć zaproszenie.");
    const { data, error } = await sb.from("home_invites").select("home_id,email,status").eq("token", token).maybeSingle();
    if (error) throw error;
    if (!data || data.status !== "pending") throw new Error("Zaproszenie jest nieaktywne.");
    const { error: memberError } = await sb.from("home_members").upsert({ home_id: data.home_id, user_id: user.id, role: "member" }, { onConflict: "home_id,user_id" });
    if (memberError) throw memberError;
    await sb.from("home_invites").update({ status: "accepted", accepted_by: user.id, accepted_at: new Date().toISOString() }).eq("token", token);
    localStorage.setItem("pa_current_home", data.home_id);
    await fullSync(true);
  }
  function wireInviteUI() {
    const status = document.querySelector("#invite-status");
    document.querySelector("#invite-create")?.addEventListener("click", async () => {
      try { const token = await createInvite(document.querySelector("#invite-email").value.trim()); status.textContent = "Kod zaproszenia: " + token; }
      catch (e) { status.textContent = e.message || "Nie udało się utworzyć zaproszenia."; }
    });
    document.querySelector("#invite-accept")?.addEventListener("click", async () => {
      try { await acceptInvite(document.querySelector("#invite-token").value.trim()); status.textContent = "Zaproszenie przyjęte."; }
      catch (e) { status.textContent = e.message || "Nie udało się przyjąć zaproszenia."; }
    });
  }
  Object.assign(window.PlantAppCloud, { createInvite, acceptInvite });

  // ---------- ZDARZENIA ----------
  window.addEventListener("pa:change", schedulePush);
  window.addEventListener("pa:places-change", schedulePush);
  window.addEventListener("pa:delete", (e) => { tombs.add(e.detail); schedulePush(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && user && Date.now() - lastPull > 5 * 60000) fullSync(false);
  });
  window.addEventListener("online", () => { if (user) fullSync(false); });

  sb.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    settingsLoaded = false;
    emitUser();
    renderCloudUI();
  wireInviteUI();
    if (user) { showAuthScreen(false); fullSync(false); }
    else { userSettings = {}; emitSettings(); if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true); }
  });

  wireAuthScreen();
  renderCloudUI();
  // pierwsze wejście bez sesji → onboarding (onAuthStateChange INITIAL_SESSION też to złapie)
  if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
})();
