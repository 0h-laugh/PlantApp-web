/* PlantApp cloud — konto + synchronizacja multi-device (Supabase).
   Po zalogowaniu Supabase jest źródłem synchronizacji, a localStorage
   działa jako cache offline oraz bufor zmian wykonanych bez sieci. */
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
  let pushTimer = null;
  let lastPull = 0;
  let syncInProgress = false;
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

  const tombs = {
    get list() { return JSON.parse(localStorage.getItem("pa_tombstones") || "[]"); },
    add(id) { const l = this.list; if (!l.includes(id)) { l.push(id); localStorage.setItem("pa_tombstones", JSON.stringify(l)); } },
    clear() { localStorage.removeItem("pa_tombstones"); },
  };

  function syncMetaKey() { return user ? `pa_last_cloud_sync_${user.id}` : ""; }
  function lastCloudSync() { return Number(localStorage.getItem(syncMetaKey()) || 0); }
  function markCloudSynced(t = Date.now()) { localStorage.setItem(syncMetaKey(), String(t)); }
  function plantTime(plant) { return Number(plant?.updatedAt || plant?.added || 0); }
  function rowTime(row) { return new Date(row.updated_at).getTime() || 0; }
  function hasPendingLocalChange(plant) { return plantTime(plant) > lastCloudSync(); }
  function localPlants() { return JSON.parse(localStorage.getItem("pa_plants") || "[]"); }
  function samePlants(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function saveLocal(plants) {
    localStorage.setItem("pa_plants", JSON.stringify(plants));
    if (typeof renderPlants === "function") renderPlants();
  }
  function setStatus(msg, err) {
    const el = document.querySelector("#sync-status");
    if (el) { el.textContent = msg; el.classList.toggle("usage-low", !!err); }
  }
  function syncTimeText() {
    return new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
  }

  // ---------- UI ----------
  function renderCloudUI() {
    if (!user) {
      cardBody.innerHTML = `
        <p class="muted">Zaloguj się, aby Supabase zapisywał rośliny w chmurze i synchronizował je między urządzeniami. Bez konta dane zostają tylko w tej przeglądarce.</p>
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
  async function pullFromCloud() {
    if (!user) return { ok: false, shouldPush: false };
    const { data: rows, error } = await sb.from("plants").select("id,data,updated_at");
    if (error) { setStatus("Błąd pobierania: " + error.message, true); return { ok: false, shouldPush: false }; }

    lastPull = Date.now();
    const lastSync = lastCloudSync();
    const local = localPlants();
    const remoteRows = rows || [];
    const localTombs = new Set(tombs.list);
    const liveRows = remoteRows.filter(row => !(row.data && row.data.deleted));
    const remoteById = Object.fromEntries(liveRows.map(row => [row.id, row]));
    const deletedById = Object.fromEntries(remoteRows.filter(row => row.data && row.data.deleted).map(row => [row.id, row]));
    const nextById = Object.fromEntries(liveRows.filter(row => !localTombs.has(row.id)).map(row => [row.id, row.data]));
    let shouldPush = tombs.list.length > 0;

    if (!remoteRows.length && local.length && !lastSync) {
      // Pierwsze logowanie do pustego konta: zachowujemy lokalną kolekcję i wysyłamy ją do Supabase.
      shouldPush = true;
    } else {
      for (const plant of local) {
        const id = plant.id;
        if (localTombs.has(id)) continue;
        const localT = plantTime(plant);
        const remote = remoteById[id];
        const deleted = deletedById[id];
        const remoteT = remote ? rowTime(remote) : 0;
        const deletedT = deleted ? rowTime(deleted) : 0;
        const pending = lastSync && localT > lastSync;

        if (pending && localT > remoteT && localT > deletedT) {
          nextById[id] = plant;
          shouldPush = true;
        }
      }

      const next = Object.values(nextById);
      if (!samePlants(local, next)) saveLocal(next);
    }

    return { ok: true, shouldPush };
  }

  async function pushPending(forceAll) {
    if (!user) return false;
    const plants = localPlants();
    const pendingPlants = forceAll ? plants : plants.filter(hasPendingLocalChange);
    const rows = pendingPlants.map(p => ({
      id: p.id,
      user_id: user.id,
      data: p,
      updated_at: new Date(plantTime(p) || Date.now()).toISOString(),
    }));
    tombs.list.forEach(id => rows.push({ id, user_id: user.id, data: { deleted: true }, updated_at: new Date().toISOString() }));
    if (!rows.length) return true;

    const { error } = await sb.from("plants").upsert(rows, { onConflict: "id" });
    if (error) { setStatus("Błąd wysyłki: " + error.message, true); return false; }
    tombs.clear();
    return true;
  }

  async function fullSync(manual) {
    if (!user || syncInProgress) return;
    syncInProgress = true;
    setStatus(manual ? "Status synchronizacji: synchronizuję…" : "Status synchronizacji: sprawdzam chmurę…");
    const pulled = await pullFromCloud();
    if (pulled.ok) {
      const pushed = await pushPending(pulled.shouldPush && !lastCloudSync());
      if (pushed) {
        markCloudSynced();
        setStatus("Status synchronizacji: zsynchronizowano o " + syncTimeText());
      }
    }
    syncInProgress = false;
  }

  function schedulePush() {
    if (!user) return;
    clearTimeout(pushTimer);
    setStatus("Status synchronizacji: zmiany czekają na wysłanie…");
    pushTimer = setTimeout(() => fullSync(false), 4000);
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
    renderCloudUI();
    if (user) { showAuthScreen(false); fullSync(false); }
    else if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
  });

  wireAuthScreen();
  renderCloudUI();
  // pierwsze wejście bez sesji → onboarding (onAuthStateChange INITIAL_SESSION też to złapie)
  if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
})();
