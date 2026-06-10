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
  let activeHome = null;
  let homesCache = [];
  const inviteCardBody = document.querySelector("#invite-card-body");
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
      const entry = typeof item === "string" ? { id: item } : item;
      const l = this.list.filter(x => (typeof x === "string" ? x : x.id) !== entry.id);
      l.push(entry);
      localStorage.setItem("pa_tombstones", JSON.stringify(l));
    },
    clear() { localStorage.removeItem("pa_tombstones"); },
  };

  function setStatus(msg, err) {
    const el = document.querySelector("#sync-status");
    if (el) { el.textContent = msg; el.classList.toggle("usage-low", !!err); }
  }

  function randomToken() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function homeStorageKey() { return user ? `pa_active_home_${user.id}` : "pa_active_home"; }

  async function loadHomes() {
    if (!user) { homesCache = []; activeHome = null; return []; }
    const { data, error } = await sb.from("homes").select("id,name,address,user_id,created_at").order("created_at", { ascending: true });
    if (error) { setStatus("Błąd domów: " + error.message, true); return homesCache; }
    homesCache = data || [];
    return homesCache;
  }

  async function ensureHome() {
    if (!user) return null;
    await loadHomes();
    if (!homesCache.length) {
      const { data, error } = await sb.from("homes").insert({ user_id: user.id, name: "Mój dom", address: "" }).select("id,name,address,user_id,created_at").single();
      if (error) { setStatus("Nie mogę utworzyć domu: " + error.message, true); return null; }
      homesCache = [data];
    }
    const saved = localStorage.getItem(homeStorageKey());
    activeHome = homesCache.find(h => h.id === saved) || homesCache[0] || null;
    if (activeHome) localStorage.setItem(homeStorageKey(), activeHome.id);
    return activeHome;
  }

  function renderInviteUI(message = "") {
    if (!inviteCardBody) return;
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      inviteCardBody.innerHTML = `<p class="muted">Backend Supabase nie jest skonfigurowany.</p>`;
      return;
    }
    if (!user) {
      inviteCardBody.innerHTML = `<p class="muted">Zaloguj się, aby zapraszać domowników i przyjmować zaproszenia.</p>`;
      return;
    }
    const homeOptions = homesCache.map(h => `<option value="${h.id}" ${activeHome?.id === h.id ? "selected" : ""}>${esc(h.name || "Dom")}${h.address ? " — " + esc(h.address) : ""}</option>`).join("");
    inviteCardBody.innerHTML = `
      <p class="muted small">Aktywny dom/adres decyduje, które pokoje i rośliny są synchronizowane na tym urządzeniu.</p>
      <div class="row">
        <select id="home-select" ${homesCache.length < 2 ? "disabled" : ""}>${homeOptions}</select>
      </div>
      <div class="row">
        <input type="email" id="invite-email" placeholder="email@example.com" autocomplete="email">
        <button class="btn btn-primary" id="invite-send">Zaproś</button>
      </div>
      <div class="row">
        <input type="text" id="invite-token" placeholder="Token zaproszenia (opcjonalnie)">
        <button class="btn btn-ghost" id="invite-accept">Akceptuj</button>
      </div>
      <div id="invite-msg" class="muted small">${esc(message)}</div>
      <div id="invite-lists" class="muted small"></div>`;

    const sel = document.querySelector("#home-select");
    if (sel) sel.onchange = async () => {
      activeHome = homesCache.find(h => h.id === sel.value) || activeHome;
      if (activeHome) localStorage.setItem(homeStorageKey(), activeHome.id);
      await pullMerge(true);
      await pushAll();
      renderInviteUI("Przełączono dom.");
      await renderInvites();
    };
    document.querySelector("#invite-send").onclick = async () => {
      const email = document.querySelector("#invite-email").value.trim();
      const result = await createInvite(email);
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

  async function createInvite(email) {
    if (!user || !activeHome) return { ok: false, message: "Najpierw zaloguj się i wybierz dom." };
    if (!/^\S+@\S+\.\S+$/.test(email)) return { ok: false, message: "Podaj poprawny e-mail." };
    const token = randomToken();
    const expires = new Date(Date.now() + 7 * 86400000).toISOString();
    const { error } = await sb.from("home_invites").insert({
      home_id: activeHome.id,
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
      activeHome ? sb.from("home_invites").select("id,home_id,email,token,status,expires_at").eq("home_id", activeHome.id).eq("status", "pending").gt("expires_at", now).order("expires_at", { ascending: true }) : { data: [], error: null },
      sb.from("home_invites").select("id,home_id,email,token,status,expires_at,homes(name,address)").eq("email", user.email.toLowerCase()).eq("status", "pending").gt("expires_at", now).order("expires_at", { ascending: true }),
    ]);
    if (outgoingRes.error) setStatus("Błąd zaproszeń: " + outgoingRes.error.message, true);
    if (incomingRes.error) setStatus("Błąd zaproszeń: " + incomingRes.error.message, true);
    return { outgoing: outgoingRes.data || [], incoming: incomingRes.data || [] };
  }

  async function renderInvites() {
    const box = document.querySelector("#invite-lists");
    if (!box || !user) return;
    const { outgoing, incoming } = await getPendingInvites();
    const outHtml = outgoing.length
      ? `<div><strong>Wysłane:</strong>${outgoing.map(i => `<div>${esc(i.email)} · token: <code>${esc(i.token)}</code> · do ${new Date(i.expires_at).toLocaleDateString("pl-PL")}</div>`).join("")}</div>`
      : `<div>Brak oczekujących zaproszeń wysłanych z aktywnego domu.</div>`;
    const inHtml = incoming.length
      ? `<div><strong>Do zaakceptowania:</strong>${incoming.map(i => `<div>${esc(i.homes?.name || "Dom")}${i.homes?.address ? " — " + esc(i.homes.address) : ""} · <button class="btn btn-ghost accept-inline" data-token="${esc(i.token)}">Akceptuj</button></div>`).join("")}</div>`
      : `<div>Brak oczekujących zaproszeń na Twój e-mail.</div>`;
    box.innerHTML = outHtml + inHtml;
    box.querySelectorAll(".accept-inline").forEach(b => b.onclick = async () => {
      const result = await acceptInvite(b.dataset.token);
      await loadHomes();
      activeHome = homesCache.find(h => h.id === localStorage.getItem(homeStorageKey())) || activeHome;
      renderInviteUI(result.message);
      await renderInvites();
    });
  }

  async function acceptInvite(token) {
    if (!user) return { ok: false, message: "Zaloguj się, aby zaakceptować zaproszenie." };
    const q = sb.from("home_invites").select("id,home_id,email,status,expires_at").eq("email", user.email.toLowerCase()).eq("status", "pending").gt("expires_at", new Date().toISOString());
    const { data: invites, error: findError } = token ? await q.eq("token", token).limit(1) : await q.limit(1);
    if (findError) return { ok: false, message: "Błąd odczytu zaproszenia: " + findError.message };
    const invite = (invites || [])[0];
    if (!invite) return { ok: false, message: "Nie znaleziono aktywnego zaproszenia dla tego konta." };
    const { error: memberError } = await sb.from("home_members").upsert({ home_id: invite.home_id, user_id: user.id, role: "editor", invited_by: null }, { onConflict: "home_id,user_id" });
    if (memberError) return { ok: false, message: "Błąd dodawania do domu: " + memberError.message };
    const { error: updateError } = await sb.from("home_invites").update({ status: "accepted" }).eq("id", invite.id);
    if (updateError) return { ok: false, message: "Dodano do domu, ale nie udało się zamknąć zaproszenia: " + updateError.message };
    await loadHomes();
    activeHome = homesCache.find(h => h.id === invite.home_id) || activeHome;
    if (activeHome) localStorage.setItem(homeStorageKey(), activeHome.id);
    await pullMerge(true);
    return { ok: true, message: "Zaproszenie zaakceptowane. Pokazuję tylko ten dom, jego pokoje i rośliny." };
  }

  window.PlantCloud = { createInvite, getPendingInvites, acceptInvite, loadHomes };

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
        <p class="muted small">Dom: <strong>${esc(activeHome?.name || "—")}</strong>${activeHome?.address ? " — " + esc(activeHome.address) : ""}</p>
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
    if (!activeHome) await ensureHome();
    if (!activeHome) return;
    const rows = plants.map(p => {
      if (!p.homeId) p.homeId = activeHome.id;
      const { _cloudUserId, ...data } = p;
      return {
        id: p.id,
        user_id: _cloudUserId || user.id,
        home_id: p.homeId,
        room_id: p.roomId || null,
        data,
        updated_at: new Date(p.updatedAt || p.added || Date.now()).toISOString(),
      };
    }).filter(r => r.home_id === activeHome.id);
    tombs.list.forEach(item => {
      const t = typeof item === "string" ? { id: item } : item;
      rows.push({ id: t.id, user_id: t.userId || user.id, home_id: t.homeId || activeHome.id, data: { deleted: true, homeId: t.homeId || activeHome.id }, updated_at: new Date().toISOString() });
    });
    if (!rows.length) return;
    const ownRows = rows.filter(r => r.user_id === user.id);
    const sharedRows = rows.filter(r => r.user_id !== user.id);
    if (ownRows.length) {
      const { error } = await sb.from("plants").upsert(ownRows, { onConflict: "id" });
      if (error) { setStatus("Błąd wysyłki: " + error.message, true); return; }
    }
    for (const row of sharedRows) {
      const { id, user_id: _owner, ...patch } = row;
      const { error } = await sb.from("plants").update(patch).eq("id", id);
      if (error) { setStatus("Błąd wysyłki: " + error.message, true); return; }
    }
    tombs.clear();
    setStatus("Zsynchronizowano: " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
  }

  async function pullMerge(replaceHomeScope = false) {
    if (!user) return;
    if (!activeHome) await ensureHome();
    if (!activeHome) return;
    const { data: rows, error } = await sb.from("plants").select("id,user_id,home_id,room_id,data,updated_at").eq("home_id", activeHome.id);
    if (error) { setStatus("Błąd pobierania: " + error.message, true); return; }
    lastPull = Date.now();
    const local = replaceHomeScope ? [] : localPlants().filter(p => !p.homeId || p.homeId === activeHome.id);
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
      if (!mine || remoteT > mineT) { byId[row.id] = { ...row.data, homeId: row.home_id, roomId: row.room_id || row.data?.roomId, _cloudUserId: row.user_id }; changed = true; }
    }
    if (changed || replaceHomeScope) saveLocal(Object.values(byId));
  }

  async function fullSync(manual) {
    if (!user) return;
    setStatus(manual ? "Synchronizuję…" : "…");
    await ensureHome();
    renderCloudUI();
    renderInviteUI();
    await renderInvites();
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
  window.addEventListener("pa:delete", (e) => { tombs.add(e.detail); schedulePush(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && user && Date.now() - lastPull > 5 * 60000) fullSync(false);
  });
  window.addEventListener("online", () => { if (user) fullSync(false); });

  sb.auth.onAuthStateChange((_event, session) => {
    user = session?.user || null;
    renderCloudUI();
    renderInviteUI();
    if (user) { showAuthScreen(false); fullSync(false); }
    else if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
  });

  wireAuthScreen();
  renderCloudUI();
  renderInviteUI();
  // pierwsze wejście bez sesji → onboarding (onAuthStateChange INITIAL_SESSION też to złapie)
  if (!localStorage.getItem("pa_skipauth")) showAuthScreen(true);
})();
