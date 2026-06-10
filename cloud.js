/* PlantApp cloud — konto + synchronizacja multi-device (Supabase).
   Offline-first: localStorage jest źródłem prawdy na urządzeniu,
   chmura to replika scalana per-roślina po updated_at z łączeniem dzienników. */
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
  const inviteCardBody = document.querySelector("#invite-card-body");
  window.PA_USER = null;

  function displayNameFor(u) {
    return u?.user_metadata?.full_name || u?.user_metadata?.name || u?.email || null;
  }

  function exposeCurrentUser() {
    window.PA_USER = user ? { id: user.id, email: user.email, displayName: displayNameFor(user) } : null;
    window.dispatchEvent(new CustomEvent("pa:user", { detail: window.PA_USER }));
  }
  const authScreen = document.querySelector("#view-auth");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

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
      const entry = typeof item === "string" ? { id: item } : item;
      if (!entry || !entry.id) return;
      const l = this.list.filter(x => (typeof x === "string" ? x : x.id) !== entry.id);
      l.push(entry);
      localStorage.setItem("pa_tombstones", JSON.stringify(l));
    },
    get ids() { return new Set(this.list.map(t => typeof t === "string" ? t : t.id)); },
    clear() { localStorage.removeItem("pa_tombstones"); },
  };

  function setStatus(msg, err) {
    const el = document.querySelector("#sync-status");
    if (el) { el.textContent = msg; el.classList.toggle("usage-low", !!err); }
  }

  // ---------- ZAPROSZENIA DO DOMU ----------
  function randomToken() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function renderInviteUI(message = "") {
    if (!inviteCardBody) return;
    if (!user) {
      inviteCardBody.innerHTML = `<p class="muted">Zaloguj się, aby zapraszać domowników i przyjmować zaproszenia.</p>`;
      return;
    }
    const homes = localHomes();
    const homeOptions = homes.map(h => `<option value="${esc(h.id)}">${esc(h.name || "Dom")}${h.address ? " — " + esc(h.address) : ""}</option>`).join("");
    inviteCardBody.innerHTML = `
      <div class="row">
        <select id="invite-home-select" class="room-select">${homeOptions}</select>
      </div>
      <div class="row">
        <input type="email" id="invite-email" placeholder="email@example.com" autocomplete="off">
        <button class="btn btn-primary" id="invite-send">Zaproś</button>
      </div>
      <div class="row">
        <input type="text" id="invite-token" placeholder="Token zaproszenia (opcjonalnie)">
        <button class="btn btn-ghost" id="invite-accept">Akceptuj</button>
      </div>
      <div id="invite-msg" class="muted small">${esc(message)}</div>
      <div id="invite-lists" class="muted small"></div>`;
    document.querySelector("#invite-send").onclick = async () => {
      const email = document.querySelector("#invite-email").value.trim();
      const homeId = document.querySelector("#invite-home-select").value;
      const result = await createInvite(email, homeId);
      renderInviteUI(result.message);
      await renderInvites();
    };
    document.querySelector("#invite-accept").onclick = async () => {
      const token = document.querySelector("#invite-token").value.trim();
      const result = await acceptInvite(token);
      renderInviteUI(result.message);
      await renderInvites();
    };
  }

  async function createInvite(email, homeId) {
    if (!user) return { ok: false, message: "Najpierw zaloguj się." };
    if (!homeId) return { ok: false, message: "Wybierz dom do udostępnienia." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Podaj poprawny e-mail." };
    await pushAll(); // dom musi istnieć w chmurze zanim wstawimy zaproszenie (FK)
    const token = randomToken();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const { error } = await sb.from("home_invites").insert({
      home_id: homeId,
      email: email.toLowerCase(),
      token,
      status: "pending",
      invited_by: user.id,
      expires_at: expires,
    });
    if (error) return { ok: false, message: "Błąd zaproszenia: " + error.message };
    return { ok: true, token, message: `Zaproszenie utworzone. Przekaż token: ${token}` };
  }

  async function getPendingInvites() {
    if (!user) return { outgoing: [], incoming: [] };
    const now = new Date().toISOString();
    const [outgoingRes, incomingRes] = await Promise.all([
      sb.from("home_invites").select("id,home_id,email,token,status,expires_at").eq("invited_by", user.id).eq("status", "pending").gt("expires_at", now).order("expires_at", { ascending: true }),
      sb.from("home_invites").select("id,home_id,email,token,status,expires_at,homes(name,address)").eq("email", (user.email || "").toLowerCase()).eq("status", "pending").gt("expires_at", now).order("expires_at", { ascending: true }),
    ]);
    if (outgoingRes.error) setStatus("Błąd zaproszeń: " + outgoingRes.error.message, true);
    if (incomingRes.error) setStatus("Błąd zaproszeń: " + incomingRes.error.message, true);
    return { outgoing: outgoingRes.data || [], incoming: incomingRes.data || [] };
  }

  async function renderInvites() {
    const box = document.querySelector("#invite-lists");
    if (!box || !user) return;
    const { outgoing, incoming } = await getPendingInvites();
    const homesById = Object.fromEntries(localHomes().map(h => [h.id, h]));
    const outHtml = outgoing.length
      ? `<div><strong>Wysłane:</strong>${outgoing.map(i => `<div>${esc(i.email)} → ${esc(homesById[i.home_id]?.name || "dom")} · token: <code>${esc(i.token)}</code> · do ${new Date(i.expires_at).toLocaleDateString("pl-PL")}</div>`).join("")}</div>`
      : `<div>Brak oczekujących zaproszeń wysłanych przez Ciebie.</div>`;
    const inHtml = incoming.length
      ? `<div><strong>Do zaakceptowania:</strong>${incoming.map(i => `<div>${esc(i.homes?.name || "Dom")}${i.homes?.address ? " — " + esc(i.homes.address) : ""} · <button class="btn btn-ghost accept-inline" data-token="${esc(i.token)}">Akceptuj</button></div>`).join("")}</div>`
      : `<div>Brak oczekujących zaproszeń na Twój e-mail.</div>`;
    box.innerHTML = outHtml + inHtml;
    box.querySelectorAll(".accept-inline").forEach(b => b.onclick = async () => {
      const result = await acceptInvite(b.dataset.token);
      renderInviteUI(result.message);
      await renderInvites();
    });
  }

  async function acceptInvite(token) {
    if (!user) return { ok: false, message: "Zaloguj się, aby zaakceptować zaproszenie." };
    const q = () => sb.from("home_invites").select("id,home_id,email,status,expires_at").eq("email", (user.email || "").toLowerCase()).eq("status", "pending").gt("expires_at", new Date().toISOString());
    const { data: invites, error: findError } = token ? await q().eq("token", token).limit(1) : await q().limit(1);
    if (findError) return { ok: false, message: "Błąd odczytu zaproszenia: " + findError.message };
    const invite = (invites || [])[0];
    if (!invite) return { ok: false, message: "Nie znaleziono aktywnego zaproszenia dla tego konta." };
    const { error: memberError } = await sb.from("home_members").upsert({ home_id: invite.home_id, user_id: user.id, role: "member" }, { onConflict: "home_id,user_id" });
    if (memberError) return { ok: false, message: "Błąd dodawania do domu: " + memberError.message };
    const { error: updateError } = await sb.from("home_invites").update({ status: "accepted" }).eq("id", invite.id);
    if (updateError) return { ok: false, message: "Dodano do domu, ale nie udało się zamknąć zaproszenia: " + updateError.message };
    await fullSync(false);
    return { ok: true, message: "Zaproszenie zaakceptowane — wspólny dom, pokoje i rośliny pojawią się na liście miejsc." };
  }

  window.PlantCloud = { createInvite, getPendingInvites, acceptInvite };

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
        <p class="muted small">Supabase jest źródłem synchronizacji. Dane w tej przeglądarce są cache’em offline i buforem zmian wykonanych bez sieci.</p>
        <div id="sync-status" class="muted small">Status synchronizacji: oczekiwanie…</div>
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

  function journalKey(e) {
    if (e.id) return "id:" + e.id;
    return [e.type || "", e.t || "", e.userId || "", e.userEmail || "", e.displayName || "", e.text || "", e.name || "", e.score || "", e.src || "", e.photo || ""].join("|");
  }

  function journalTime(e) { return Number(e?.t || 0) || 0; }

  function mergeJournal(localJournal = [], remoteJournal = []) {
    const merged = new Map();
    [...localJournal, ...remoteJournal].forEach(entry => {
      if (!entry) return;
      const normalized = { userId: null, userEmail: null, displayName: "local", ...entry };
      merged.set(journalKey(normalized), normalized);
    });
    return [...merged.values()].sort((a, b) => journalTime(a) - journalTime(b));
  }

  function latestJournalEntry(journal, type) {
    return journal.filter(e => e.type === type).sort((a, b) => journalTime(b) - journalTime(a))[0];
  }

  function mergePlantData(localPlant, remotePlant, remoteT) {
    if (!localPlant) return remotePlant;
    const localT = localPlant.updatedAt || localPlant.added || 0;
    const base = remoteT > localT ? { ...remotePlant } : { ...localPlant };
    const journal = mergeJournal(localPlant.journal || [], remotePlant.journal || []);
    base.journal = journal;
    const lastWater = latestJournalEntry(journal, "water");
    const lastFert = latestJournalEntry(journal, "fert");
    if (lastWater) base.lastWatered = lastWater.t;
    if (lastFert) base.lastFertilized = lastFert.t;
    base.updatedAt = Math.max(localT, remoteT, base.updatedAt || 0);
    return base;
  }
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
    // cudzych domów nie nadpisujemy (RLS: update tylko właściciel)
    const homes = localHomes()
      .filter(h => !h.ownerId || h.ownerId === user.id)
      .map(h => ({
        id: h.id,
        owner_id: h.ownerId || user.id,
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
    const rows = plants.map(p => {
      const { _cloudUserId, ...data } = p;
      return {
        id: p.id,
        user_id: _cloudUserId || user.id,
        home_id: p.homeId || null,
        room_id: p.roomId || null,
        data,
        updated_at: new Date(p.updatedAt || p.added || Date.now()).toISOString(),
      };
    });
    tombs.list.forEach(item => {
      const t = typeof item === "string" ? { id: item } : item;
      rows.push({ id: t.id, user_id: t.userId || user.id, home_id: t.homeId || null, room_id: null, data: { deleted: true }, updated_at: new Date().toISOString() });
    });
    if (!rows.length && !homes.length && !rooms.length) return;
    // własne rośliny: upsert; cudze (współdzielone): update bez zmiany właściciela
    const ownRows = rows.filter(r => r.user_id === user.id);
    const sharedRows = rows.filter(r => r.user_id !== user.id);
    if (ownRows.length) {
      const { error } = await sb.from("plants").upsert(ownRows, { onConflict: "id" });
      if (error) { setStatus("Błąd wysyłki roślin: " + error.message, true); return; }
    }
    for (const row of sharedRows) {
      const { id, user_id: _owner, ...patch } = row;
      const { error } = await sb.from("plants").update(patch).eq("id", id);
      if (error) { setStatus("Błąd wysyłki roślin: " + error.message, true); return; }
    }
    tombs.clear();
    setStatus("Zsynchronizowano: " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
  }

  async function pullMerge() {
    if (!user) return;
    const { data: homeRows, error: homesError } = await sb.from("homes").select("id,owner_id,name,address,created_at,updated_at");
    if (homesError) { setStatus("Błąd pobierania miejsc: " + homesError.message, true); return; }
    const { data: roomRows, error: roomsError } = await sb.from("rooms").select("id,home_id,name,sort_order,created_at,updated_at");
    if (roomsError) { setStatus("Błąd pobierania pokoi: " + roomsError.message, true); return; }
    const { data: rows, error } = await sb.from("plants").select("id,user_id,home_id,room_id,data,updated_at");
    if (error) { setStatus("Błąd pobierania roślin: " + error.message, true); return; }
    lastPull = Date.now();

    const homesById = Object.fromEntries(localHomes().map(h => [h.id, h]));
    for (const row of homeRows || []) {
      const remoteT = new Date(row.updated_at).getTime();
      const mine = homesById[row.id];
      const mineT = mine ? (mine.updatedAt || mine.createdAt || 0) : 0;
      if (!mine || remoteT > mineT) homesById[row.id] = { id: row.id, ownerId: row.owner_id, name: row.name, address: row.address || "", createdAt: new Date(row.created_at).getTime(), updatedAt: remoteT };
      else if (mine && !mine.ownerId) mine.ownerId = row.owner_id;
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
    const deadHere = tombs.ids;

    for (const row of rows || []) {
      const remoteT = new Date(row.updated_at).getTime();
      const mine = byId[row.id];
      const mineT = mine ? (mine.updatedAt || mine.added || 0) : 0;
      if (row.data && row.data.deleted) {
        if (mine && mineT <= remoteT) { delete byId[row.id]; changed = true; }
        continue;
      }
      if (deadHere.has(row.id)) continue; // lokalnie usunięta, tombstone poleci przy push
      const remoteData = { ...row.data, homeId: row.data?.homeId || row.home_id || "", roomId: row.data?.roomId || row.room_id || "", _cloudUserId: row.user_id };
      if (!mine) { byId[row.id] = remoteData; changed = true; }
      else {
        const merged = mergePlantData(mine, remoteData, remoteT);
        if (!merged._cloudUserId) merged._cloudUserId = row.user_id;
        if (JSON.stringify(merged) !== JSON.stringify(mine)) { byId[row.id] = merged; changed = true; }
      }
    }
    if (changed) saveLocal(Object.values(byId));
  }

  async function fullSync(manual) {
    if (!user) return;
    setStatus(manual ? "Synchronizuję…" : "…");
    await Promise.all([pullMerge(), loadSettings().catch(() => null)]);
    await pushAll();
    renderInviteUI();
    await renderInvites();
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => fullSync(false), 4000);
  }

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
    exposeCurrentUser();
    settings = { apiKey: "" };
    settingsLoaded = false;
    settingsError = "";
    emitSettings();
    renderCloudUI();
    renderInviteUI();
    if (user) { showAuthScreen(false); fullSync(false); }
    else {
      settingsLoaded = true;
      emitSettings();
      if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
    }
  });

  wireAuthScreen();
  renderCloudUI();
  renderInviteUI();
  // pierwsze wejście bez sesji → onboarding (onAuthStateChange INITIAL_SESSION też to złapie)
  if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
})();
