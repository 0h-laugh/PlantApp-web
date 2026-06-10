/* PlantApp cloud — konto + synchronizacja multi-device (Supabase).
   Offline-first: localStorage jest źródłem prawdy na urządzeniu,
   chmura to replika scalana per-polowe + addytywny dziennik po journalEntry.id. */
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
  const FIELD_KEYS = ["name", "latin", "photo", "lastWatered", "lastFertilized", "customInterval"];
  const PHOTO_PREFIX = "photo:";
  const deviceId = (() => {
    let id = localStorage.getItem("pa_device_id");
    if (!id) {
      id = (globalThis.crypto?.randomUUID?.() || `dev_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`);
      localStorage.setItem("pa_device_id", id);
    }
    return id;
  })();

  function localPlants() { return JSON.parse(localStorage.getItem("pa_plants") || "[]"); }
  function saveLocal(plants) { localStorage.setItem("pa_plants", JSON.stringify(plants)); if (typeof renderPlants === "function") renderPlants(); }
  function toMs(v) {
    if (!v) return 0;
    if (typeof v === "number") return v;
    const t = new Date(v).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  function iso(v) { return new Date(toMs(v) || Date.now()).toISOString(); }
  function uid(prefix = "id") { return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`; }
  function actor() { return user?.id || deviceId; }
  function clockAt(updatedAt) { return { updatedAt, updatedBy: actor() }; }
  function newerClock(a, b) { return toMs(a?.updatedAt) >= toMs(b?.updatedAt) ? a : b; }
  function plantUpdatedAt(p) {
    const clocks = Object.values(p.fieldClock || {}).map(c => toMs(c?.updatedAt));
    const entries = (p.journal || []).map(e => toMs(e.updatedAt || e.t));
    return Math.max(toMs(p.updatedAt), toMs(p.added), 0, ...clocks, ...entries);
  }
  function normalizeJournalEntry(entry, plant, index) {
    const t = toMs(entry.t) || toMs(plant.added) || Date.now();
    const updatedAt = toMs(entry.updatedAt) || toMs(plant.updatedAt) || t;
    return {
      ...entry,
      id: entry.id || `je_${plant.id}_${t}_${index}`,
      t,
      updatedAt,
      updatedBy: entry.updatedBy || actor(),
    };
  }
  function normalizePlant(plant) {
    const now = Date.now();
    const updatedAt = toMs(plant.updatedAt) || toMs(plant.added) || now;
    const p = { ...plant, updatedAt };
    p.added = toMs(p.added) || updatedAt;
    p.fieldClock = { ...(p.fieldClock || {}) };
    FIELD_KEYS.forEach(field => {
      if (p[field] !== undefined && !p.fieldClock[field]) p.fieldClock[field] = clockAt(updatedAt);
    });
    p.journal = (p.journal || []).map((entry, index) => normalizeJournalEntry(entry, p, index));
    p.updatedAt = plantUpdatedAt(p) || updatedAt;
    return p;
  }
  function normalizePlants(plants) { return plants.map(normalizePlant); }
  function sameJson(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function metadataSnapshot(p) {
    const data = { ...p };
    delete data.journal;
    return data;
  }
  function photoRowsFor(p) {
    const rows = [];
    if (p.photo) rows.push({ id: PHOTO_PREFIX + p.id, user_id: user.id, plant_id: p.id, journal_entry_id: null, kind: "cover", photo: p.photo, updated_at: iso(p.fieldClock?.photo?.updatedAt || p.updatedAt) });
    (p.journal || []).forEach(e => {
      if (e.photo) rows.push({ id: PHOTO_PREFIX + e.id, user_id: user.id, plant_id: p.id, journal_entry_id: e.id, kind: "journal", photo: e.photo, updated_at: iso(e.updatedAt || e.t) });
    });
    return rows;
  }
  function journalRowsFor(p) {
    return (p.journal || []).map(e => {
      const data = { ...e };
      delete data.photo;
      return { id: e.id, user_id: user.id, plant_id: p.id, data, entry_time: iso(e.t), updated_at: iso(e.updatedAt || e.t) };
    });
  }

  async function legacyPushAll(plants) {
    const rows = plants.map(p => ({
      id: p.id,
      user_id: user.id,
      data: p,
      updated_at: iso(plantUpdatedAt(p)),
    }));
    tombs.list.forEach(id => rows.push({ id, user_id: user.id, data: { deleted: true }, updated_at: new Date().toISOString() }));
    if (!rows.length) return { error: null };
    return sb.from("plants").upsert(rows, { onConflict: "id" });
  }

  async function pushAll() {
    if (!user) return;
    const before = localPlants();
    const plants = normalizePlants(before);
    if (!sameJson(before, plants)) saveLocal(plants);

    const plantRows = plants.map(p => ({
      id: p.id,
      user_id: user.id,
      name: p.name || null,
      latin: p.latin || null,
      added: iso(p.added),
      last_watered: p.lastWatered ? iso(p.lastWatered) : null,
      last_fertilized: p.lastFertilized ? iso(p.lastFertilized) : null,
      custom_interval: p.customInterval ?? null,
      field_clock: p.fieldClock || {},
      data: metadataSnapshot(p),
      deleted_at: null,
      updated_at: iso(plantUpdatedAt(p)),
    }));
    tombs.list.forEach(id => plantRows.push({ id, user_id: user.id, data: { deleted: true }, field_clock: {}, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }));

    const journalRows = plants.flatMap(journalRowsFor);
    const photoRows = plants.flatMap(photoRowsFor);
    if (!plantRows.length && !journalRows.length && !photoRows.length) return;

    let { error } = await sb.from("plants").upsert(plantRows, { onConflict: "id" });
    if (error && /column|schema|cache|plant_journal_entries|plant_photos/i.test(error.message)) {
      ({ error } = await legacyPushAll(plants));
    } else if (!error && journalRows.length) {
      ({ error } = await sb.from("plant_journal_entries").upsert(journalRows, { onConflict: "id" }));
      if (!error && photoRows.length) ({ error } = await sb.from("plant_photos").upsert(photoRows, { onConflict: "id" }));
      if (error && /column|schema|cache|plant_journal_entries|plant_photos|relation/i.test(error.message)) {
        ({ error } = await legacyPushAll(plants));
      }
    }
    if (error) { setStatus("Błąd wysyłki: " + error.message, true); return; }
    tombs.clear();
    setStatus("Zsynchronizowano: " + new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" }));
  }

  function rowToPlant(row) {
    const data = row.data || {};
    const p = normalizePlant({
      ...data,
      id: row.id,
      name: row.name ?? data.name,
      latin: row.latin ?? data.latin,
      added: toMs(row.added) || data.added,
      lastWatered: toMs(row.last_watered) || data.lastWatered,
      lastFertilized: toMs(row.last_fertilized) || data.lastFertilized,
      customInterval: row.custom_interval ?? data.customInterval,
      fieldClock: row.field_clock || data.fieldClock || {},
      updatedAt: toMs(row.updated_at) || data.updatedAt,
      journal: data.journal || [],
    });
    if (row.deleted_at || data.deleted) p.deletedAt = toMs(row.deleted_at || row.updated_at);
    return p;
  }
  function attachJournalAndPhotos(plants, journalRows, photoRows) {
    const byId = Object.fromEntries(plants.map(p => [p.id, p]));
    (journalRows || []).forEach(row => {
      const p = byId[row.plant_id];
      if (!p || row.deleted_at) return;
      p.journal = p.journal || [];
      p.journal.push(normalizeJournalEntry({ ...(row.data || {}), id: row.id, t: toMs(row.entry_time), updatedAt: toMs(row.updated_at) }, p, p.journal.length));
    });
    (photoRows || []).forEach(row => {
      const p = byId[row.plant_id];
      if (!p) return;
      if (row.kind === "cover") {
        p.photo = row.photo;
        p.fieldClock = { ...(p.fieldClock || {}), photo: newerClock(p.fieldClock?.photo, { updatedAt: toMs(row.updated_at), updatedBy: row.user_id }) };
      } else if (row.journal_entry_id) {
        const e = (p.journal || []).find(x => x.id === row.journal_entry_id);
        if (e) e.photo = row.photo;
      }
    });
    return plants.map(normalizePlant);
  }
  async function fetchRemotePlants() {
    const { data: plantRows, error } = await sb.from("plants").select("id,data,updated_at,deleted_at,name,latin,added,last_watered,last_fertilized,custom_interval,field_clock");
    if (error) {
      const legacy = await sb.from("plants").select("id,data,updated_at");
      if (legacy.error) return { error: legacy.error };
      return { plants: (legacy.data || []).map(rowToPlant), legacy: true };
    }
    const [journals, photos] = await Promise.all([
      sb.from("plant_journal_entries").select("id,plant_id,data,entry_time,updated_at,deleted_at"),
      sb.from("plant_photos").select("id,plant_id,journal_entry_id,kind,photo,updated_at,user_id"),
    ]);
    if (journals.error || photos.error) return { plants: (plantRows || []).map(rowToPlant), legacy: true };
    return { plants: attachJournalAndPhotos((plantRows || []).map(rowToPlant), journals.data || [], photos.data || []) };
  }
  function mergeJournal(localEntries = [], remoteEntries = []) {
    const byId = new Map();
    [...localEntries, ...remoteEntries].forEach((entry, index) => {
      const e = normalizeJournalEntry(entry, { id: "merge", added: entry.t }, index);
      const old = byId.get(e.id);
      if (!old || toMs(e.updatedAt || e.t) >= toMs(old.updatedAt || old.t)) byId.set(e.id, { ...old, ...e });
    });
    return [...byId.values()].sort((a, b) => a.t - b.t);
  }
  function mergePlants(localPlant, remotePlant) {
    if (!localPlant) return normalizePlant(remotePlant);
    const local = normalizePlant(localPlant);
    const remote = normalizePlant(remotePlant);
    const merged = { ...local, fieldClock: { ...(local.fieldClock || {}) } };
    FIELD_KEYS.forEach(field => {
      const chosen = newerClock(local.fieldClock?.[field], remote.fieldClock?.[field]);
      if (chosen === remote.fieldClock?.[field] && remote[field] !== undefined) merged[field] = remote[field];
      merged.fieldClock[field] = chosen || local.fieldClock?.[field] || remote.fieldClock?.[field];
      if (field === "customInterval" && chosen === remote.fieldClock?.[field] && remote[field] === undefined) delete merged[field];
    });
    merged.added = toMs(local.added) && toMs(remote.added) ? Math.min(toMs(local.added), toMs(remote.added)) : (toMs(local.added) || toMs(remote.added));
    merged.journal = mergeJournal(local.journal, remote.journal);
    merged.updatedAt = Math.max(plantUpdatedAt(local), plantUpdatedAt(remote));
    return normalizePlant(merged);
  }

  async function pullMerge() {
    if (!user) return;
    const { plants: remotePlants, error } = await fetchRemotePlants();
    if (error) { setStatus("Błąd pobierania: " + error.message, true); return; }
    lastPull = Date.now();
    const local = normalizePlants(localPlants());
    const byId = Object.fromEntries(local.map(p => [p.id, p]));
    let changed = !sameJson(localPlants(), local);
    const deadHere = new Set(tombs.list);

    for (const remote of remotePlants || []) {
      const mine = byId[remote.id];
      if (remote.deletedAt) {
        if (mine && plantUpdatedAt(mine) <= remote.deletedAt) { delete byId[remote.id]; changed = true; }
        continue;
      }
      if (deadHere.has(remote.id)) continue; // lokalnie usunięta, tombstone poleci przy push
      const merged = mergePlants(mine, remote);
      if (!mine || !sameJson(mine, merged)) { byId[remote.id] = merged; changed = true; }
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
