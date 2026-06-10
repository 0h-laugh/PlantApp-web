/* PlantApp cloud — konto + synchronizacja multi-device (Supabase).
   Offline-first: localStorage jest źródłem prawdy na urządzeniu,
   chmura to replika scalana per-roślina po updated_at (last-write-wins). */
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
    tombs.list.forEach(id => rows.push({ id, user_id: user.id, data: { deleted: true }, updated_at: new Date().toISOString() }));
    if (!rows.length && !homes.length && !rooms.length) return;
    const { error } = rows.length ? await sb.from("plants").upsert(rows, { onConflict: "id" }) : { error: null };
    if (error) { setStatus("Błąd wysyłki roślin: " + error.message, true); return; }
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
      if (!mine || remoteT > mineT) {
        byId[row.id] = { ...row.data, homeId: row.data?.homeId || row.home_id || "", roomId: row.data?.roomId || row.room_id || "" };
        changed = true;
      }
    }
    if (changed) saveLocal(Object.values(byId));
  }

  async function fullSync(manual) {
    if (!user) return;
    setStatus(manual ? "Synchronizuję…" : "…");
    await pullMerge();
    await pushAll();
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushAll, 4000);
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
    renderCloudUI();
    if (user) { showAuthScreen(false); fullSync(false); }
    else if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
  });

  wireAuthScreen();
  renderCloudUI();
  // pierwsze wejście bez sesji → onboarding (onAuthStateChange INITIAL_SESSION też to złapie)
  if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
})();
