/* PlantApp v1.1 — dziennik per roślina, Doktor przypisany do rośliny, ewolucja w czasie. */
"use strict";

// ============ STAN ============
const store = {
  get plants() { return JSON.parse(localStorage.getItem("pa_plants") || "[]"); },
  set plants(v) {
    try { localStorage.setItem("pa_plants", JSON.stringify(v)); }
    catch (e) { toast("⚠️ Pamięć pełna — usuń stare zdjęcia z dziennika lub zrób eksport"); }
    window.dispatchEvent(new CustomEvent("pa:change"));
  },
  get homes() { return JSON.parse(localStorage.getItem("pa_homes") || "[]"); },
  set homes(v) { localStorage.setItem("pa_homes", JSON.stringify(v)); window.dispatchEvent(new CustomEvent("pa:places-change")); },
  get rooms() { return JSON.parse(localStorage.getItem("pa_rooms") || "[]"); },
  set rooms(v) { localStorage.setItem("pa_rooms", JSON.stringify(v)); window.dispatchEvent(new CustomEvent("pa:places-change")); },
  get currentHomeId() { return localStorage.getItem("pa_current_home") || ""; },
  set currentHomeId(v) { v ? localStorage.setItem("pa_current_home", v) : localStorage.removeItem("pa_current_home"); },
  get currentRoomId() { return localStorage.getItem("pa_current_room") || ""; },
  set currentRoomId(v) { v ? localStorage.setItem("pa_current_room", v) : localStorage.removeItem("pa_current_room"); },
  get apiKey() { return localStorage.getItem("pa_apikey") || ""; },
  set apiKey(v) { localStorage.setItem("pa_apikey", v); },
  get usage() {
    const u = JSON.parse(localStorage.getItem("pa_usage") || "{}");
    const today = new Date().toISOString().slice(0, 10);
    return u.date === today ? u : { date: today, identify: 0, diseases: 0, remaining: null };
  },
  set usage(v) { localStorage.setItem("pa_usage", JSON.stringify(v)); },
  get rooms() { return JSON.parse(localStorage.getItem("pa_rooms") || "[]"); },
  set rooms(v) {
    localStorage.setItem("pa_rooms", JSON.stringify(v));
    window.dispatchEvent(new CustomEvent("pa:change"));
  },
};

const DAILY_QUOTA = 500;
function bumpUsage(kind, remaining) {
  const u = store.usage;
  u[kind] = (u[kind] || 0) + 1;
  if (typeof remaining === "number") u.remaining = remaining;
  store.usage = u;
  renderUsage();
}
function renderUsage() {
  const u = store.usage;
  const used = (u.identify || 0) + (u.diseases || 0);
  const left = typeof u.remaining === "number" ? u.remaining : Math.max(0, DAILY_QUOTA - used);
  const exact = typeof u.remaining === "number";
  const txt = `Pozostało dziś: ${exact ? "" : "~"}${left}/${DAILY_QUOTA} zapytań AI`;
  const cls = left <= 25 ? " usage-low" : "";
  const el1 = $("#scan-usage"), el2 = $("#doctor-usage"), el3 = $("#usage-card-body");
  if (el1) { el1.textContent = txt; el1.className = "usage-line" + cls; }
  if (el2) { el2.textContent = txt; el2.className = "usage-line" + cls; }
  if (el3) el3.innerHTML = `
    <div class="usage-grid">
      <div><div class="usage-num">${u.identify || 0}</div><div class="usage-k">skany gatunków</div></div>
      <div><div class="usage-num">${u.diseases || 0}</div><div class="usage-k">diagnozy AI</div></div>
      <div><div class="usage-num${cls ? " usage-low" : ""}">${exact ? "" : "~"}${left}</div><div class="usage-k">pozostało dziś</div></div>
    </div>
    <p class="muted small">Limit darmowy PlantNet: ${DAILY_QUOTA} zapytań dziennie (skany + diagnozy łącznie). ${exact ? "Wartość potwierdzona przez serwer." : "Szacunek lokalny — doprecyzuje się po pierwszym zapytaniu."} Tryb „Po objawach” i cała pielęgnacja nie zużywają limitu.</p>`;
}

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;

function isSummer() { const m = new Date().getMonth() + 1; return m >= 4 && m <= 9; }
function fmtDate(t) { return new Date(t).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: new Date(t).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }); }
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

// ============ MIGRACJA v1.0 → v1.2 (miejsca/pokoje + history → journal) ============
const DEFAULT_HOME_NAME = "Mój dom";
const DEFAULT_ROOM_NAME = "Bez pokoju";

window.ensureDefaultPlace = ensureDefaultPlace;
function ensureDefaultPlace() {
  let homes = store.homes;
  let rooms = store.rooms;
  let changedHomes = false, changedRooms = false;
  let home = homes[0];
  if (!home) {
    const now = Date.now();
    home = { id: "home_" + uid(), name: DEFAULT_HOME_NAME, address: "", createdAt: now, updatedAt: now };
    homes = [home];
    changedHomes = true;
  }
  let room = rooms.find(r => r.homeId === home.id && r.name === DEFAULT_ROOM_NAME) || rooms.find(r => r.homeId === home.id);
  if (!room) {
    const now = Date.now();
    room = { id: "room_" + uid(), homeId: home.id, name: DEFAULT_ROOM_NAME, sortOrder: 0, createdAt: now, updatedAt: now };
    rooms = [room, ...rooms];
    changedRooms = true;
  }
  if (!store.currentHomeId || !homes.some(h => h.id === store.currentHomeId)) store.currentHomeId = home.id;
  if (store.currentRoomId && !rooms.some(r => r.id === store.currentRoomId && r.homeId === store.currentHomeId)) store.currentRoomId = "";
  if (changedHomes) store.homes = homes;
  if (changedRooms) store.rooms = rooms;
  return { homeId: home.id, roomId: room.id };
}

// ============ POKOJE I MIEJSCA — CRUD ============
function addRoom(name, homeId = store.currentHomeId) {
  const trimmed = String(name || "").trim();
  if (!trimmed) { toast("Podaj nazwę pokoju"); return null; }
  ensureDefaultPlace();
  const rooms = store.rooms;
  const now = Date.now();
  const room = { id: "room_" + uid(), homeId: homeId || store.currentHomeId, name: trimmed, sortOrder: rooms.filter(r => r.homeId === homeId).length, createdAt: now, updatedAt: now };
  rooms.push(room);
  store.rooms = rooms;
  return room;
}
function renameRoom(roomId, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) { toast("Podaj nazwę pokoju"); return false; }
  const rooms = store.rooms;
  const room = rooms.find(r => r.id === roomId);
  if (!room) return false;
  room.name = trimmed;
  room.updatedAt = Date.now();
  store.rooms = rooms;
  return true;
}
function deleteRoom(roomId) {
  const room = store.rooms.find(r => r.id === roomId);
  if (!room) return false;
  if (store.plants.some(p => p.roomId === roomId)) { toast("Najpierw przenieś rośliny z tego pokoju"); return false; }
  store.rooms = store.rooms.filter(r => r.id !== roomId);
  if (store.currentRoomId === roomId) store.currentRoomId = "";
  window.dispatchEvent(new CustomEvent("pa:place-delete", { detail: { kind: "room", id: roomId } }));
  ensureDefaultPlace();
  return true;
}
function addHome(name, address) {
  const trimmed = String(name || "").trim();
  if (!trimmed) { toast("Podaj nazwę miejsca"); return null; }
  const homes = store.homes;
  const now = Date.now();
  const home = { id: "home_" + uid(), name: trimmed, address: String(address || "").trim(), createdAt: now, updatedAt: now };
  homes.push(home);
  store.homes = homes;
  store.currentHomeId = home.id;
  store.currentRoomId = "";
  ensureDefaultPlace();
  return home;
}
function renameHome(homeId, name, address) {
  const trimmed = String(name || "").trim();
  if (!trimmed) { toast("Podaj nazwę miejsca"); return false; }
  const homes = store.homes;
  const home = homes.find(h => h.id === homeId);
  if (!home) return false;
  home.name = trimmed;
  home.address = String(address || "").trim();
  home.updatedAt = Date.now();
  store.homes = homes;
  return true;
}
function movePlantToRoom(plantId, roomId) {
  const room = store.rooms.find(r => r.id === roomId);
  if (!room) return false;
  mutatePlant(plantId, p => { p.roomId = room.id; p.homeId = room.homeId; });
  return true;
}
window.addRoom = addRoom;
window.renameRoom = renameRoom;
window.deleteRoom = deleteRoom;
window.addHome = addHome;
window.renameHome = renameHome;
window.movePlantToRoom = movePlantToRoom;
(function migrate() {
  const def = ensureDefaultPlace();
  const rooms = store.rooms;
  const plants = store.plants;
  let changed = false;
  plants.forEach(p => {
    if (!p.journal) {
      p.journal = [{ t: p.added || Date.now(), type: "added" }];
      (p.history || []).forEach(t => p.journal.push({ t, type: "water" }));
      delete p.history;
      changed = true;
    }
    if (!p.homeId || !store.homes.some(h => h.id === p.homeId)) { p.homeId = def.homeId; changed = true; }
    if (!p.roomId || !rooms.some(r => r.id === p.roomId && r.homeId === p.homeId)) { p.roomId = def.roomId; changed = true; }
  });
  if (changed) store.plants = plants;
})();

// ============ DZIENNIK ============
function addJournal(plantId, entry) {
  const plants = store.plants;
  const p = plants.find(x => x.id === plantId);
  if (!p) return false;
  p.journal = p.journal || [];
  p.journal.push({ t: Date.now(), ...entry });
  p.updatedAt = Date.now();
  if (entry.type === "water") p.lastWatered = entry.t || Date.now();
  if (entry.type === "fert") p.lastFertilized = entry.t || Date.now();
  store.plants = plants;
  return true;
}

// ============ BAZA PIELĘGNACJI ============
function careFor(latinName) {
  if (!latinName) return CARE_DEFAULT;
  const lower = latinName.toLowerCase();
  for (const key of Object.keys(CARE_DB)) if (lower.includes(key)) return CARE_DB[key];
  return CARE_DEFAULT;
}
function currentInterval(plant) {
  if (plant.customInterval) return plant.customInterval;
  const c = careFor(plant.latin);
  return isSummer() ? c.waterSummer : c.waterWinter;
}
function daysUntilWater(plant) {
  const last = plant.lastWatered || plant.added;
  return Math.ceil((last + currentInterval(plant) * DAY - Date.now()) / DAY);
}
const FERT_INTERVAL = 30; // dni, tylko w sezonie wzrostu
function daysUntilFert(plant) {
  if (!isSummer()) return null; // zima = przerwa w nawożeniu
  const last = plant.lastFertilized || plant.added;
  return Math.ceil((last + FERT_INTERVAL * DAY - Date.now()) / DAY);
}
function lastDiagnosis(plant) {
  return (plant.journal || []).filter(e => e.type === "diagnosis").slice(-1)[0] || null;
}

// ============ ASYSTENT — wnioski z dziennika ============
function diagAction(name) {
  for (const d of Object.values(DISEASE_DB)) if (d.pl === name) return d.action;
  for (const s of SYMPTOMS_DB) if (s.label === name) return s.action;
  return null;
}
function plantInsights(p) {
  const out = [];
  const j = p.journal || [];
  const d = daysUntilWater(p);
  const f = daysUntilFert(p);
  const care = careFor(p.latin);
  const interval = currentInterval(p);

  if (d <= 0) out.push({ prio: 0, ico: "💧", text: `Podlej dziś${d < 0 ? ` — spóźnienie ${-d} ${-d === 1 ? "dzień" : "dni"}` : ""}.` });

  // dyscyplina podlewania: realny rytm z dziennika vs plan
  const waters = j.filter(e => e.type === "water").map(e => e.t).sort((a, b) => a - b);
  if (waters.length >= 4) {
    const gaps = waters.slice(1).map((t, i) => (t - waters[i]) / DAY);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg < interval * 0.65) out.push({ prio: 1, ico: "⚠️", text: `Podlewasz średnio co ${avg.toFixed(1)} dnia przy planie co ${interval} — ryzyko przelania. Sprawdzaj palcem 2–3 cm ziemi przed podlaniem.` });
    else if (avg > interval * 1.45) out.push({ prio: 1, ico: "🏜️", text: `Realny rytm to co ~${Math.round(avg)} dni przy planie co ${interval} — roślina bywa przesuszana. Skróć odstępy albo dostosuj plan przyciskiem ±.` });
  }

  // kontrola po diagnozie
  const diag = lastDiagnosis(p);
  if (diag) {
    const days = Math.floor((Date.now() - diag.t) / DAY);
    if (days >= 3 && days <= 21) {
      const act = diagAction(diag.name);
      out.push({ prio: 0, ico: "🩺", text: `${days} dni po diagnozie „${diag.name}” — sprawdź, czy objawy ustępują.${act ? " Przypomnienie: " + act.split(".")[0] + "." : ""} Jeśli nie ma poprawy, zrób kontrolne zdjęcie w Doktorze.` });
    }
  }

  if (f !== null && f <= 0) out.push({ prio: 1, ico: "🌿", text: "Czas nawieźć — ostatnie nawożenie ponad miesiąc temu w sezonie wzrostu." });
  if (!isSummer() && /wysok/i.test(care.humidity)) out.push({ prio: 2, ico: "💨", text: "Sezon grzewczy + roślina lubiąca wilgoć: zraszaj lub dostaw nawilżacz, obserwuj końcówki liści." });

  const photos = j.filter(e => e.photo);
  const lastPhoto = Math.max(p.added || 0, ...photos.map(e => e.t));
  if (Date.now() - lastPhoto > 30 * DAY) out.push({ prio: 3, ico: "📷", text: "Ponad miesiąc bez zdjęcia — dodaj jedno do ewolucji, łatwiej wychwycisz powolne zmiany." });

  return out.sort((a, b) => a.prio - b.prio);
}
function allInsights(limit = 4) {
  const items = [];
  filteredPlants().forEach(p => plantInsights(p).forEach(i => items.push({ ...i, plant: p })));
  return items.sort((a, b) => a.prio - b.prio).slice(0, limit);
}

// ============ AI ASYSTENT ROŚLINY ============
const ASSISTANT_STORAGE_KEY = "pa_assistant_messages";
let activeAssistantPlantId = null;
let assistantSending = false;
let assistantCloudWarn = "";
let assistantSb = null;

function assistantStore() {
  return JSON.parse(localStorage.getItem(ASSISTANT_STORAGE_KEY) || "{}");
}
function saveAssistantStore(data) {
  localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(data));
}
function assistantMessages(plantId) {
  return assistantStore()[plantId] || [];
}
function setAssistantMessages(plantId, messages) {
  const data = assistantStore();
  data[plantId] = messages.slice(-40);
  saveAssistantStore(data);
}
function addAssistantMessage(plantId, role, content, extra = {}) {
  const message = { id: uid(), role, content: String(content || ""), t: Date.now(), ...extra };
  setAssistantMessages(plantId, [...assistantMessages(plantId), message]);
  return message;
}
function getAssistantClient() {
  if (assistantSb) return assistantSb;
  const cfg = window.PA_CONFIG || {};
  if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
  assistantSb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  return assistantSb;
}
function buildAssistantContext(p) {
  const journal = (p.journal || []).slice().sort((a, b) => b.t - a.t);
  const diagnoses = journal.filter(e => e.type === "diagnosis").slice(0, 5).map(e => ({
    date: fmtDate(e.t), name: e.name, score: e.score || null, source: e.src || "unknown",
  }));
  const notes = journal.filter(e => e.type === "note").slice(0, 5).map(e => ({ date: fmtDate(e.t), text: e.text }));
  const recentJournal = journal.slice(0, 8).map(e => {
    const label = (JOURNAL_META[e.type] || { label: () => e.type }).label(e).replace(/<[^>]*>/g, "");
    return { date: fmtDate(e.t), type: e.type, label };
  });
  const fert = daysUntilFert(p);
  const waterIn = daysUntilWater(p);
  const care = careFor(p.latin);
  return {
    plant: { id: p.id, name: p.name, latin: p.latin || "", added: fmtDate(p.added || Date.now()) },
    recentJournal,
    diagnoses,
    notes,
    schedule: {
      watering: {
        everyDays: currentInterval(p),
        daysUntilNext: waterIn,
        lastWatered: p.lastWatered ? fmtDate(p.lastWatered) : null,
        season: isSummer() ? "sezon wzrostu" : "spoczynek zimowy",
      },
      fertilizing: {
        everyDays: FERT_INTERVAL,
        daysUntilNext: fert,
        lastFertilized: p.lastFertilized ? fmtDate(p.lastFertilized) : null,
        active: fert !== null,
      },
    },
    care: { light: care.light, humidity: care.humidity, tips: care.tips, toxic: care.toxic ?? null },
  };
}
async function loadAssistantMessagesFromSupabase(plantId) {
  const sb = getAssistantClient();
  if (!sb) return;
  const { data: sessionData } = await sb.auth.getSession();
  if (!sessionData?.session) return;
  const { data, error } = await sb
    .from("plant_assistant_messages")
    .select("role,content,created_at")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) { assistantCloudWarn = "Historia lokalna działa, ale tabela Supabase plant_assistant_messages nie jest jeszcze dostępna."; return; }
  if (data?.length) {
    setAssistantMessages(plantId, data.map(row => ({ id: uid(), role: row.role, content: row.content, t: new Date(row.created_at).getTime() || Date.now(), fromCloud: true })));
  }
}
async function saveAssistantMessageToSupabase(plantId, message, context) {
  try {
    const sb = getAssistantClient();
    if (!sb) return;
    const { data: sessionData } = await sb.auth.getSession();
    const user = sessionData?.session?.user;
    if (!user) return;
    const row = {
      plant_id: plantId,
      user_id: user.id,
      role: message.role,
      content: message.content,
      context: message.role === "user" ? context : null,
      created_at: new Date(message.t).toISOString(),
    };
    let { error } = await sb.from("plant_assistant_messages").insert(row);
    if (error) {
      ({ error } = await sb.from("plant_assistant_messages").insert({ plant_id: plantId, role: message.role, content: message.content }));
    }
    assistantCloudWarn = error ? "Nie udało się zapisać tej wiadomości w Supabase — sprawdź tabelę plant_assistant_messages i polityki RLS." : "";
  } catch (err) {
    assistantCloudWarn = "Nie udało się zapisać wiadomości w Supabase.";
  }
}
function renderAssistantMessages(plantId) {
  const p = store.plants.find(x => x.id === plantId);
  const shell = $("#plant-assistant-shell");
  if (!p || !shell) return;
  const messages = assistantMessages(plantId);
  shell.classList.remove("hidden");
  shell.innerHTML = `
    <div class="assistant-chat-head">
      <div>
        <div class="sec-k">🤖 AI asystent</div>
        <p class="assistant-safe">Asystent daje porady ogrodnicze na podstawie danych rośliny i nie zastępuje profesjonalnej diagnozy ani badania laboratoryjnego.</p>
      </div>
    </div>
    <div class="assistant-messages" id="assistant-messages">
      ${messages.length ? messages.map(m => `<div class="assistant-msg assistant-msg-${m.role}">
        <div class="assistant-msg-role">${m.role === "user" ? "Ty" : "Asystent"}</div>
        <div class="assistant-msg-content">${esc(m.content)}</div>
      </div>`).join("") : `<div class="assistant-empty">Zapytaj o podlewanie, nawożenie, objawy albo ostatnie wpisy z dziennika rośliny.</div>`}
      ${assistantSending ? `<div class="assistant-msg assistant-msg-assistant"><div class="assistant-msg-role">Asystent</div><div class="assistant-msg-content"><span class="spinner"></span>Analizuję kontekst rośliny…</div></div>` : ""}
    </div>
    ${assistantCloudWarn ? `<div class="assistant-warning">${esc(assistantCloudWarn)}</div>` : ""}
    <form class="assistant-form" id="assistant-form">
      <input id="assistant-input" type="text" placeholder="Napisz pytanie o ${esc(p.name)}…" autocomplete="off" ${assistantSending ? "disabled" : ""}>
      <button class="btn btn-primary" type="submit" ${assistantSending ? "disabled" : ""}>Wyślij</button>
    </form>`;
  const form = $("#assistant-form");
  form.onsubmit = (e) => {
    e.preventDefault();
    const input = $("#assistant-input");
    const message = input.value.trim();
    if (message) sendAssistantMessage(plantId, message);
  };
  const list = $("#assistant-messages");
  if (list) list.scrollTop = list.scrollHeight;
}
async function openAssistant(plantId) {
  activeAssistantPlantId = plantId;
  assistantCloudWarn = "";
  renderAssistantMessages(plantId);
  await loadAssistantMessagesFromSupabase(plantId);
  if (activeAssistantPlantId === plantId) renderAssistantMessages(plantId);
}
async function sendAssistantMessage(plantId, message) {
  const p = store.plants.find(x => x.id === plantId);
  if (!p || assistantSending) return;
  const context = buildAssistantContext(p);
  const userMessage = addAssistantMessage(plantId, "user", message);
  assistantSending = true;
  renderAssistantMessages(plantId);
  await saveAssistantMessageToSupabase(plantId, userMessage, context);
  try {
    const sb = getAssistantClient();
    if (!sb) throw new Error("Backend Supabase nie jest skonfigurowany.");
    const history = assistantMessages(plantId).slice(-10).map(m => ({ role: m.role, content: m.content }));
    const { data, error } = await sb.functions.invoke("plant-assistant", { body: { plantId, message, context, history } });
    if (error) throw error;
    const reply = data?.reply || data?.message || data?.content;
    if (!reply) throw new Error("Edge Function plant-assistant nie zwróciła odpowiedzi.");
    const assistantMessage = addAssistantMessage(plantId, "assistant", reply);
    await saveAssistantMessageToSupabase(plantId, assistantMessage, context);
  } catch (err) {
    const fallback = "Nie mogę teraz połączyć się z backendem AI. Sprawdź Supabase Edge Function `plant-assistant`; klucz modelu powinien być tylko po stronie backendu, nie w przeglądarce.";
    addAssistantMessage(plantId, "assistant", fallback);
    assistantCloudWarn = err.message || fallback;
  } finally {
    assistantSending = false;
    renderAssistantMessages(plantId);
  }
}
window.openAssistant = openAssistant;
window.sendAssistantMessage = sendAssistantMessage;

// ============ NAWIGACJA ============
function goto(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + view).classList.add("active");
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.goto === view));
  window.scrollTo(0, 0);
  if (view === "plants") renderPlants();
  if (view === "doctor") renderDoctorPlantPicker();
  if (view === "scan" || view === "doctor") updateKeyWarnings();
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); goto(g.dataset.goto); }
});

// ============ PIERŚCIEŃ PODLEWANIA ============
function ringSVG(plant, size = 54) {
  const interval = currentInterval(plant);
  const daysLeft = daysUntilWater(plant);
  const frac = Math.max(0, Math.min(1, daysLeft / interval));
  const r = (size / 2) - 4, c = 2 * Math.PI * r;
  const overdue = daysLeft <= 0;
  return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="Podlewanie za ${daysLeft} dni">
    <svg width="${size}" height="${size}">
      <circle class="ring-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="5"/>
      <circle class="ring-fill ${overdue ? "overdue" : ""}" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="5"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"/>
    </svg>
    <div class="ring-label">${overdue ? "💧" : daysLeft}<small>${overdue ? "" : (daysLeft === 1 ? "dzień" : "dni")}</small></div>
  </div>`;
}

function currentHome() {
  ensureDefaultPlace();
  return store.homes.find(h => h.id === store.currentHomeId) || store.homes[0];
}
function roomsForHome(homeId = store.currentHomeId) {
  return store.rooms.filter(r => r.homeId === homeId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name, "pl"));
}
function filteredPlants() {
  ensureDefaultPlace();
  return store.plants.filter(p => p.homeId === store.currentHomeId && (!store.currentRoomId || p.roomId === store.currentRoomId));
}
function roomName(id) { return store.rooms.find(r => r.id === id)?.name || DEFAULT_ROOM_NAME; }
function homeLabel(h) { return h.address ? `${h.name} · ${h.address}` : h.name; }
function renderPlaceControls() {
  const homeSelect = $("#home-select"), roomChips = $("#room-chips"), hint = $("#place-filter-hint");
  if (!homeSelect || !roomChips) return;
  ensureDefaultPlace();
  const homes = store.homes;
  homeSelect.innerHTML = homes.map(h => `<option value="${esc(h.id)}" ${h.id === store.currentHomeId ? "selected" : ""}>${esc(homeLabel(h))}</option>`).join("")
    + `<option value="__edit_home">✎ Edytuj to miejsce…</option><option value="__add_home">＋ Dodaj miejsce…</option>`;
  homeSelect.value = store.currentHomeId;
  const rooms = roomsForHome();
  const activeRoomOk = !store.currentRoomId || rooms.some(r => r.id === store.currentRoomId);
  if (!activeRoomOk) store.currentRoomId = "";
  const activeRoom = rooms.find(r => r.id === store.currentRoomId);
  const activeRoomEmpty = activeRoom && !store.plants.some(p => p.roomId === activeRoom.id);
  roomChips.innerHTML = `<button class="chip ${!store.currentRoomId ? "active" : ""}" data-room="">Wszystkie pokoje</button>`
    + rooms.map(r => `<button class="chip ${r.id === store.currentRoomId ? "active" : ""}" data-room="${esc(r.id)}">${esc(r.name)}</button>`).join("")
    + `<button class="chip chip-action" data-action="add-room" aria-label="Dodaj pokój">＋ Pokój</button>`
    + (activeRoom ? `<button class="chip chip-action" data-action="rename-room" aria-label="Zmień nazwę pokoju">✎</button>` : "")
    + (activeRoomEmpty ? `<button class="chip chip-action chip-danger" data-action="delete-room" aria-label="Usuń pokój">✕</button>` : "");
  const home = currentHome();
  const count = filteredPlants().length;
  if (hint) hint.textContent = `${count} ${count === 1 ? "roślina" : count < 5 ? "rośliny" : "roślin"} · ${homeLabel(home)}${store.currentRoomId ? " · " + roomName(store.currentRoomId) : ""}`;
}

// ============ LISTA ROŚLIN (siatka kafli) ============
function renderPlants() {
  renderPlaceControls();
  const plants = filteredPlants();
  const allPlants = store.plants;
  const list = $("#plants-list"), empty = $("#plants-empty"), banner = $("#due-banner");
  list.innerHTML = "";
  empty.classList.toggle("hidden", allPlants.length > 0);

  const due = plants.filter(p => daysUntilWater(p) <= 0);
  const fertDue = plants.filter(p => { const f = daysUntilFert(p); return f !== null && f <= 0; });

  // hero
  const hd = $("#hero-date"), hl = $("#hero-line");
  if (hd) hd.textContent = new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" }) + " · " + (isSummer() ? "sezon wzrostu" : "spoczynek zimowy");
  if (hl) {
    if (!allPlants.length) hl.textContent = "Zacznij od pierwszego skanu";
    else if (due.length) hl.innerHTML = `<span class="hero-num">${due.length}</span> ${due.length === 1 ? "roślina czeka" : due.length < 5 ? "rośliny czekają" : "roślin czeka"} na wodę`;
    else hl.innerHTML = `Wszystko podlane <span class="hero-ok">✓</span>`;
  }

  banner.classList.add("hidden"); // baner zastąpiony przez Asystenta

  // Asystent — wnioski z dziennika
  const aBox = $("#assistant-box");
  if (aBox) {
    const ins = allInsights(4);
    if (!ins.length) { aBox.classList.add("hidden"); aBox.innerHTML = ""; }
    else {
      aBox.classList.remove("hidden");
      aBox.innerHTML = `<div class="as-head"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 21 C 5.5 17, 4.5 9.5, 12 3.5 C 19.5 9.5, 18.5 17, 12 21 Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg> Asystent</div>`
        + ins.map(i => `<button class="as-item" data-plant="${i.plant.id}">
            <span class="as-ico">${i.ico}</span>
            <span class="as-txt"><strong>${esc(i.plant.name)}:</strong> ${esc(i.text)}</span>
          </button>`).join("");
      aBox.querySelectorAll("[data-plant]").forEach(b => b.onclick = () => openDetail(b.dataset.plant));
    }
  }

  plants.slice().sort((a, b) => daysUntilWater(a) - daysUntilWater(b)).forEach((p, i) => {
    const d = daysUntilWater(p);
    const f = daysUntilFert(p);
    const diag = lastDiagnosis(p);
    const recentDiag = diag && (Date.now() - diag.t) < 21 * DAY;
    const el = document.createElement("div");
    el.className = "tile" + (d <= 0 ? " tile-due" : "");
    el.style.animationDelay = (i * 45) + "ms";
    el.innerHTML = `
      ${p.photo ? `<img class="tile-photo" src="${p.photo}" alt="" loading="lazy">` : `<div class="tile-photo tile-ph"><svg viewBox="0 0 24 24" width="34" height="34"><path d="M12 21 C 5.5 17, 4.5 9.5, 12 3.5 C 19.5 9.5, 18.5 17, 12 21 Z M12 20 L 12 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>`}
      <div class="tile-ring">${ringSVG(p, 44)}</div>
      ${recentDiag ? `<div class="tile-flag" title="${esc(diag.name)}">🩺</div>` : ""}
      ${f !== null && f <= 0 ? `<div class="tile-flag tile-flag2" title="czas nawieźć">🌿</div>` : ""}
      <div class="tile-grad"></div>
      <div class="tile-meta">
        <div class="tile-name">${esc(p.name)}</div>
        <div class="tile-due-txt ${d <= 0 ? "overdue" : ""}">${esc(roomName(p.roomId))} · ${d <= 0 ? "podlej dziś" : "woda za " + d + " dn."}</div>
      </div>`;
    el.addEventListener("click", () => openDetail(p.id));
    list.appendChild(el);
  });
}

// ============ SZCZEGÓŁY ROŚLINY: dziennik + ewolucja ============
const JOURNAL_META = {
  added: { ico: "🌱", label: () => "Dodano do kolekcji" },
  water: { ico: "💧", label: () => "Podlano" },
  fert: { ico: "🌿", label: () => "Nawożono" },
  diagnosis: { ico: "🩺", label: e => `Diagnoza: ${esc(e.name)}${e.score ? " (" + e.score + "%)" : ""}${e.src === "objawy" ? " — z objawów" : ""}` },
  photo: { ico: "📷", label: () => "Zdjęcie" },
  note: { ico: "📝", label: e => esc(e.text) },
};

function openDetail(id) {
  const p = store.plants.find(x => x.id === id);
  if (!p) return;
  const care = careFor(p.latin);
  const d = daysUntilWater(p);
  const fert = daysUntilFert(p);
  const interval = currentInterval(p);
  ensureDefaultPlace();
  const homes = store.homes;
  const rooms = roomsForHome(p.homeId);
  const activeRoomId = p.roomId;
  const journal = (p.journal || []).slice().sort((a, b) => b.t - a.t);

  // ewolucja: wszystkie zdjęcia w czasie (start + dziennik), chronologicznie
  const evoPhotos = [];
  if (p.photo) evoPhotos.push({ t: p.added, photo: p.photo, tag: "start" });
  (p.journal || []).filter(e => e.photo).sort((a, b) => a.t - b.t).forEach(e => evoPhotos.push({ t: e.t, photo: e.photo, tag: e.type === "diagnosis" ? "🩺" : "" }));

  $("#plant-detail-content").innerHTML = `
    <div class="detail-hero">
      ${p.photo ? `<img class="detail-photo" src="${p.photo}" alt="">` : `<div class="detail-photo">🪴</div>`}
      <div>
        <div class="detail-name">${esc(p.name)}</div>
        <div class="detail-latin">${esc(p.latin || "")}</div>
        <div class="detail-latin">📍 ${esc(homeLabel(store.homes.find(h => h.id === p.homeId) || currentHome()))} · ${esc(roomName(p.roomId))}</div>
        ${care.toxic === true ? `<div style="color:var(--alert);font-size:.8rem;margin-top:4px">⚠️ Toksyczna dla zwierząt</div>` : care.toxic === false ? `<div style="color:var(--leaf);font-size:.8rem;margin-top:4px">✓ Bezpieczna dla zwierząt</div>` : ""}
      </div>
    </div>

    <div class="card room-select-card">
      <label for="plant-home" class="sec-k">Miejsce</label>
      <select id="plant-home" class="room-select">
        ${homes.map(h => `<option value="${esc(h.id)}" ${h.id === p.homeId ? "selected" : ""}>${esc(homeLabel(h))}</option>`).join("")}
      </select>
      <label for="plant-room" class="sec-k" style="margin-top:10px">Pokój</label>
      <select id="plant-room" class="room-select">
        ${rooms.map(r => `<option value="${esc(r.id)}" ${r.id === activeRoomId ? "selected" : ""}>${esc(r.name)}</option>`).join("")}
      </select>
    </div>

    <div class="water-block">
      ${ringSVG(p, 76)}
      <div style="flex:1">
        <div style="font-weight:800">${d <= 0 ? "Czas podlać!" : "Podlewanie za " + d + " " + (d === 1 ? "dzień" : "dni")}</div>
        <div class="muted" style="margin:4px 0 10px">co ${interval} dni (${isSummer() ? "sezon letni" : "sezon zimowy"})</div>
        <button class="btn btn-water" id="water-now">💧 Podlałem/am teraz</button>
      </div>
    </div>

    <div class="fert-block">
      <div class="fert-ico">🌿</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.92rem">${fert === null ? "Nawożenie: przerwa zimowa" : fert <= 0 ? "Czas nawieźć!" : "Nawożenie za " + fert + " " + (fert === 1 ? "dzień" : "dni")}</div>
        <div class="muted" style="font-size:.78rem">${fert === null ? "Wznowisz w kwietniu — rośliny zimą odpoczywają." : "co " + FERT_INTERVAL + " dni w sezonie wzrostu"}</div>
      </div>
      ${fert !== null ? `<button class="btn btn-ghost" id="fert-now" style="padding:9px 14px">🌿 Nawiozłem/am</button>` : ""}
    </div>

    ${(() => { const ins = plantInsights(p); return ins.length ? `
    <div class="card as-card">
      <div class="sec-k">Asystent</div>
      ${ins.map(i => `<div class="as-line"><span class="as-ico">${i.ico}</span><span>${esc(i.text)}</span></div>`).join("")}
    </div>` : ""; })()}

    <div class="action-row">
      <label class="btn btn-ghost" for="journal-photo-file">📷 Zdjęcie do dziennika<input type="file" id="journal-photo-file" accept="image/*" capture="environment" hidden></label>
      <button class="btn btn-ghost" id="add-note">📝 Notatka</button>
      <button class="btn btn-ghost" id="diagnose-this" data-goto="doctor">🩺 Diagnozuj</button>
    </div>

    ${evoPhotos.length > 1 ? `
    <div class="card">
      <div class="sec-k">🌿 Ewolucja (${evoPhotos.length} zdjęć)</div>
      <div class="evo-strip">${evoPhotos.map(e => `
        <figure class="evo-item"><img src="${e.photo}" alt="" loading="lazy"><figcaption>${fmtDate(e.t)}${e.tag === "start" ? " · start" : e.tag ? " " + e.tag : ""}</figcaption></figure>`).join("")}
      </div>
    </div>` : ""}

    <div class="card">
      <div class="sec-k">Częstotliwość podlewania</div>
      <div class="interval-row">
        <button id="int-minus" aria-label="Rzadziej">−</button>
        <span class="interval-val">co ${interval} dni</span>
        <button id="int-plus" aria-label="Częściej">+</button>
        ${p.customInterval ? `<button class="btn btn-ghost" id="int-reset" style="padding:8px 12px;font-size:.8rem">↺ auto</button>` : ""}
      </div>
    </div>

    <div class="care-grid">
      <div class="care-cell"><div class="k">☀️ Światło</div><div class="v">${esc(care.light)}</div></div>
      <div class="care-cell"><div class="k">💨 Wilgotność</div><div class="v">${esc(care.humidity)}</div></div>
    </div>
    <div class="card"><div class="sec-k">💡 Wskazówki</div><div style="font-size:.9rem;line-height:1.55">${esc(care.tips)}</div></div>

    <div class="card">
      <div class="sec-k">📖 Dziennik (${journal.length})</div>
      ${journal.length ? `<div class="timeline">${journal.map((e, i) => {
        const m = JOURNAL_META[e.type] || { ico: "•", label: () => e.type };
        return `<div class="tl-entry">
          <div class="tl-ico">${m.ico}</div>
          <div class="tl-body">
            <div class="tl-label">${m.label(e)}</div>
            <div class="tl-date">${fmtDate(e.t)}</div>
            ${e.photo && e.type !== "photo" ? `<img class="tl-thumb" src="${e.photo}" alt="" loading="lazy">` : ""}
          </div>
          <button class="tl-del" data-del="${i}" aria-label="Usuń wpis">✕</button>
        </div>`;
      }).join("")}</div>` : `<p class="muted">Pusto. Podlej, dodaj zdjęcie albo zdiagnozuj — wszystko zapisze się tutaj.</p>`}
    </div>

    <button class="btn btn-danger btn-block" id="delete-plant">Usuń roślinę</button>
  `;

  $("#plant-room").onchange = (e) => {
    if (movePlantToRoom(id, e.target.value)) toast("Przeniesiono roślinę");
    openDetail(id);
  };
  $("#plant-home").onchange = (e) => {
    const homeId = e.target.value;
    const targetRooms = roomsForHome(homeId);
    let room = targetRooms[0];
    if (!room) {
      const now = Date.now();
      room = { id: "room_" + uid(), homeId, name: DEFAULT_ROOM_NAME, sortOrder: 0, createdAt: now, updatedAt: now };
      store.rooms = [...store.rooms, room];
    }
    if (movePlantToRoom(id, room.id)) toast("Przeniesiono roślinę");
    openDetail(id);
  };
  $("#water-now").onclick = () => { addJournal(id, { type: "water" }); toast("💧 Zapisano podlewanie"); openDetail(id); };
  const fertBtn = $("#fert-now");
  if (fertBtn) fertBtn.onclick = () => { addJournal(id, { type: "fert" }); toast("🌿 Zapisano nawożenie"); openDetail(id); };
  $("#add-note").onclick = () => {
    const text = prompt("Notatka (np. „przesadzona do większej doniczki”):");
    if (text && text.trim()) { addJournal(id, { type: "note", text: text.trim() }); openDetail(id); }
  };
  $("#journal-photo-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const photo = await blobToDataURL(await fileToCompressed(f, 420, 0.72));
    addJournal(id, { type: "photo", photo });
    toast("📷 Dodano do dziennika"); openDetail(id);
  });
  $("#diagnose-this").addEventListener("click", () => { doctorPlantId = id; }, { capture: true });
  $("#int-minus").onclick = () => { mutatePlant(id, p => p.customInterval = Math.max(1, currentInterval(p) - 1)); openDetail(id); };
  $("#int-plus").onclick = () => { mutatePlant(id, p => p.customInterval = currentInterval(p) + 1); openDetail(id); };
  const reset = $("#int-reset"); if (reset) reset.onclick = () => { mutatePlant(id, p => delete p.customInterval); openDetail(id); };
  $$("#plant-detail-content .tl-del").forEach(btn => btn.onclick = () => {
    mutatePlant(id, p => {
      const sorted = p.journal.slice().sort((a, b) => b.t - a.t);
      const victim = sorted[Number(btn.dataset.del)];
      p.journal = p.journal.filter(e => e !== victim);
    });
    openDetail(id);
  });
  $("#delete-plant").onclick = () => {
    if (confirm(`Usunąć „${p.name}" razem z dziennikiem?`)) {
      store.plants = store.plants.filter(x => x.id !== id);
      window.dispatchEvent(new CustomEvent("pa:delete", { detail: id }));
      toast("Usunięto"); goto("plants");
    }
  };
  goto("plant-detail");
  openAssistant(id);
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.goto === "plants"));
}
function mutatePlant(id, fn) {
  const plants = store.plants;
  const p = plants.find(x => x.id === id);
  if (p) {
    fn(p);
    const { rooms, defaultId } = normalizeRoomsAndPlants();
    const validRoomIds = new Set(rooms.map(r => r.id));
    if (!validRoomIds.has(getPlantRoomId(p))) applyPlantRoom(p, defaultId);
    else applyPlantRoom(p, getPlantRoomId(p));
    p.updatedAt = Date.now();
    store.plants = plants;
  }
}

// ============ ZDJĘCIA ============
function fileToCompressed(file, maxDim = 1280, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob(b => b ? resolve(b) : reject(new Error("blob")), "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
function blobToDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

// ============ SKANUJ — Pl@ntNet identify ============
let scanBlob = null, scanThumb = null, organ = "auto";

$("#scan-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  scanBlob = await fileToCompressed(f);
  scanThumb = await blobToDataURL(await fileToCompressed(f, 480, 0.8));
  $("#scan-preview").innerHTML = `<img src="${URL.createObjectURL(scanBlob)}" alt="Podgląd zdjęcia">`;
  $("#scan-go").disabled = !store.apiKey;
  $("#scan-results").innerHTML = "";
});
$("#organ-chips").addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (!c) return;
  $$("#organ-chips .chip").forEach(x => x.classList.remove("active"));
  c.classList.add("active"); organ = c.dataset.organ;
});

$("#scan-go").addEventListener("click", async () => {
  if (!scanBlob) return;
  const st = $("#scan-status");
  st.classList.remove("hidden", "error");
  st.innerHTML = `<span class="spinner"></span>Pytam Pl@ntNet AI…`;
  $("#scan-go").disabled = true;
  try {
    const fd = new FormData();
    fd.append("images", scanBlob, "photo.jpg");
    fd.append("organs", organ);
    const url = `https://my-api.plantnet.org/v2/identify/all?api-key=${encodeURIComponent(store.apiKey)}&lang=pl&nb-results=4`;
    const res = await fetch(url, { method: "POST", body: fd });
    if (res.status === 401 || res.status === 403) throw new Error("Klucz API odrzucony — sprawdź klucz i Authorized domains w panelu PlantNet.");
    if (res.status === 404) throw new Error("Nie rozpoznano rośliny. Spróbuj wyraźniejszego zdjęcia liścia lub kwiatu.");
    if (res.status === 429) throw new Error("Wyczerpany dzienny limit (500/dzień). Spróbuj jutro.");
    if (!res.ok) throw new Error("Błąd serwera Pl@ntNet (" + res.status + ").");
    const data = await res.json();
    bumpUsage("identify", data.remainingIdentificationRequests);
    renderScanResults(data.results || []);
    st.classList.add("hidden");
  } catch (err) {
    st.classList.add("error");
    st.textContent = navigator.onLine ? (err.message || "Coś poszło nie tak.") : "Brak internetu — identyfikacja wymaga połączenia.";
  } finally { $("#scan-go").disabled = false; }
});

function renderScanResults(results) {
  const box = $("#scan-results");
  if (!results.length) { box.innerHTML = `<div class="status error">Brak dopasowań. Spróbuj zdjęcia z bliska, na jednolitym tle.</div>`; return; }
  box.innerHTML = "";
  results.slice(0, 4).forEach(r => {
    const latin = r.species?.scientificNameWithoutAuthor || "?";
    const common = (r.species?.commonNames || [])[0] || "";
    const score = Math.round((r.score || 0) * 100);
    const care = careFor(latin);
    const known = care !== CARE_DEFAULT;
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-head">
        <div><div class="result-name">${esc(care.pl || common || latin)}</div><div class="result-latin">${esc(latin)}</div></div>
        <span class="score-pill ${score >= 50 ? "score-high" : "score-mid"}">${score}%</span>
      </div>
      <div class="result-body">
        ${known ? `💧 Podlewanie co ~${isSummer() ? care.waterSummer : care.waterWinter} dni · ${care.toxic ? "⚠️ toksyczna" : care.toxic === false ? "✓ bezpieczna dla zwierząt" : ""}` : "Brak w bazie pielęgnacji — dodam z ogólnym planem, dostroisz ręcznie."}
      </div>
      <div class="result-actions"><button class="btn btn-primary">＋ Dodaj do kolekcji</button></div>`;
    card.querySelector(".btn-primary").onclick = () => addPlant(latin, care.pl || common || latin);
    box.appendChild(card);
  });
}

function addPlant(latin, displayName) {
  const name = prompt("Nazwa rośliny (np. „Monstera w salonie”):", displayName) || displayName;
  const plants = store.plants;
  const place = ensureDefaultPlace();
  const homeId = store.currentHomeId || place.homeId;
  const roomId = store.currentRoomId || place.roomId;
  plants.push({ id: uid(), homeId, roomId, name, latin, photo: scanThumb, added: Date.now(), updatedAt: Date.now(), lastWatered: Date.now(), journal: [{ t: Date.now(), type: "added" }] });
  store.plants = plants;
  toast("🪴 Dodano: " + name);
  scanBlob = null; scanThumb = null;
  $("#scan-preview").innerHTML = `<span class="photo-cta">📷<br>Dotknij, by zrobić zdjęcie</span>`;
  $("#scan-results").innerHTML = ""; $("#scan-go").disabled = true;
  goto("plants");
}

// ============ DOKTOR — wybór rośliny + zapis do dziennika ============
let doctorBlob = null, doctorThumb = null, doctorPlantId = null;

function renderDoctorPlantPicker() {
  const plants = store.plants;
  const box = $("#doctor-plant-chips");
  if (!plants.length) { box.innerHTML = `<span class="muted small">Brak roślin w kolekcji — diagnoza nie zapisze się do dziennika.</span>`; doctorPlantId = null; return; }
  if (doctorPlantId && !plants.find(p => p.id === doctorPlantId)) doctorPlantId = null;
  box.innerHTML = plants.map(p => `<button class="chip ${p.id === doctorPlantId ? "active" : ""}" data-plant="${p.id}">${esc(p.name)}</button>`).join("")
    + `<button class="chip ${doctorPlantId === null ? "active" : ""}" data-plant="">bez zapisu</button>`;
  $$("#doctor-plant-chips .chip").forEach(c => c.onclick = () => {
    doctorPlantId = c.dataset.plant || null;
    renderDoctorPlantPicker();
  });
}

$$(".seg-btn").forEach(b => b.addEventListener("click", () => {
  $$(".seg-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("#doctor-photo").classList.toggle("hidden", b.dataset.mode !== "photo");
  $("#doctor-symptoms").classList.toggle("hidden", b.dataset.mode !== "symptoms");
}));

$("#doctor-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  doctorBlob = await fileToCompressed(f);
  doctorThumb = await blobToDataURL(await fileToCompressed(f, 420, 0.72));
  $("#doctor-preview").innerHTML = `<img src="${URL.createObjectURL(doctorBlob)}" alt="Podgląd zdjęcia">`;
  $("#doctor-go").disabled = !store.apiKey;
  $("#doctor-results").innerHTML = "";
});

$("#doctor-go").addEventListener("click", async () => {
  if (!doctorBlob) return;
  const st = $("#doctor-status");
  st.classList.remove("hidden", "error");
  st.innerHTML = `<span class="spinner"></span>Analizuję zdjęcie…`;
  $("#doctor-go").disabled = true;
  try {
    const fd = new FormData();
    fd.append("images", doctorBlob, "photo.jpg");
    fd.append("organs", "auto");
    const url = `https://my-api.plantnet.org/v2/diseases/identify?api-key=${encodeURIComponent(store.apiKey)}&nb-results=3`;
    const res = await fetch(url, { method: "POST", body: fd });
    if (res.status === 401 || res.status === 403) throw new Error("Klucz API odrzucony — sprawdź panel PlantNet.");
    if (res.status === 404) throw new Error("AI nie rozpoznało choroby na tym zdjęciu. Spróbuj zbliżenia zmiany — albo trybu „Po objawach”.");
    if (res.status === 429) throw new Error("Limit dzienny wyczerpany. Użyj trybu „Po objawach”.");
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json()).message || ""; } catch {}
      throw new Error("Pl@ntNet odrzucił zapytanie (" + res.status + (detail ? ": " + detail : "") + "). Spróbuj innego zdjęcia (JPG, wyraźne zbliżenie zmiany).");
    }
    const data = await res.json();
    bumpUsage("diseases", data.remainingIdentificationRequests);
    renderDoctorResults(data.results || []);
    st.classList.add("hidden");
  } catch (err) {
    st.classList.add("error");
    st.textContent = navigator.onLine ? (err.message || "Coś poszło nie tak.") : "Brak internetu — użyj trybu „Po objawach” (offline).";
  } finally { $("#doctor-go").disabled = false; }
});

function saveDiagnosis(name, score, src) {
  if (!doctorPlantId) { toast("Wybierz roślinę u góry, żeby zapisać do dziennika"); return false; }
  const ok = addJournal(doctorPlantId, { type: "diagnosis", name, score, src, photo: src === "ai" ? doctorThumb : undefined });
  if (ok) {
    const p = store.plants.find(x => x.id === doctorPlantId);
    toast(`🩺 Zapisano w dzienniku: ${p.name}`);
  }
  return ok;
}

function renderDoctorResults(results) {
  const box = $("#doctor-results");
  if (!results.length) { box.innerHTML = `<div class="status error">Brak rozpoznania. Spróbuj zbliżenia zmiany lub trybu „Po objawach”.</div>`; return; }
  box.innerHTML = "";
  results.slice(0, 3).forEach(r => {
    const code = (r.name || "").toUpperCase();
    const known = DISEASE_DB[code];
    const score = Math.round((r.score || 0) * 100);
    const displayName = known ? known.pl : (r.description || r.name || "Nieznana zmiana");
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-head">
        <div class="result-name">${esc(displayName)}</div>
        <span class="score-pill ${score >= 50 ? "score-high" : "score-mid"}">${score}%</span>
      </div>
      <div class="result-body">
        ${known ? `<strong>Jak rozpoznać:</strong> ${esc(known.what)}<br><br><strong>Co robić:</strong> ${esc(known.action)}` : `Kod EPPO: ${esc(code)}. Brak szczegółów w lokalnej bazie.`}
      </div>
      <div class="result-actions"><button class="btn btn-primary">📖 Zapisz do dziennika</button></div>`;
    card.querySelector(".btn-primary").onclick = (ev) => { if (saveDiagnosis(displayName, score, "ai")) ev.target.disabled = true, ev.target.textContent = "✓ Zapisano"; };
    box.appendChild(card);
  });
  box.insertAdjacentHTML("beforeend", `<p class="muted small">Diagnoza AI jest orientacyjna — obserwuj roślinę i porównaj z trybem „Po objawach”.</p>`);
}

// objawowy — offline, też z zapisem
function renderSymptoms() {
  $("#symptoms-list").innerHTML = SYMPTOMS_DB.map((s, i) => `
    <details class="symptom">
      <summary>${esc(s.label)}</summary>
      <div class="symptom-body">
        <strong>Prawdopodobna przyczyna:</strong> ${esc(s.causes)}<br><br>
        <strong>Co robić:</strong> ${esc(s.action)}
        <div class="result-actions"><button class="btn btn-ghost" data-sym="${i}">📖 Zapisz do dziennika</button></div>
      </div>
    </details>`).join("");
  $$("#symptoms-list [data-sym]").forEach(b => b.onclick = () => {
    const s = SYMPTOMS_DB[Number(b.dataset.sym)];
    if (saveDiagnosis(s.label, null, "objawy")) { b.disabled = true; b.textContent = "✓ Zapisano"; }
  });
}

// ============ USTAWIENIA ============
function updateKeyWarnings() {
  const has = !!store.apiKey;
  $("#scan-keywarn").classList.toggle("hidden", has);
  $("#doctor-keywarn").classList.toggle("hidden", has);
  $("#scan-go").disabled = !(has && scanBlob);
  $("#doctor-go").disabled = !(has && doctorBlob);
}
$("#save-key").addEventListener("click", () => {
  const v = $("#api-key").value.trim();
  store.apiKey = v;
  $("#key-status").textContent = v ? "✓ Klucz zapisany lokalnie." : "Klucz usunięty.";
  updateKeyWarnings();
  toast(v ? "Klucz zapisany" : "Klucz usunięty");
});

$("#export-btn").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify({ plants: store.plants, homes: store.homes, rooms: store.rooms, currentHomeId: store.currentHomeId, currentRoomId: store.currentRoomId, exported: new Date().toISOString(), version: "1.2" }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "plantapp-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  a.click();
});
$("#import-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.plants)) throw 0;
    if (Array.isArray(data.homes)) store.homes = data.homes;
    if (Array.isArray(data.rooms)) store.rooms = data.rooms;
    if (data.currentHomeId) store.currentHomeId = data.currentHomeId;
    if (data.currentRoomId) store.currentRoomId = data.currentRoomId;
    store.plants = data.plants;
    ensureDefaultPlace();
    toast("Zaimportowano " + data.plants.length + " roślin");
    goto("plants");
  } catch { toast("Nieprawidłowy plik kopii"); }
});

// ============ POWIADOMIENIA ============
$("#notif-btn").addEventListener("click", async () => {
  if (!("Notification" in window)) { $("#notif-status").textContent = "Ta przeglądarka nie obsługuje powiadomień."; return; }
  const perm = await Notification.requestPermission();
  $("#notif-status").textContent = perm === "granted" ? "✓ Powiadomienia włączone. Sprawdzam rośliny przy każdym otwarciu aplikacji." : "Powiadomienia zablokowane w ustawieniach przeglądarki.";
  if (perm === "granted") checkDueAndNotify();
});
function checkDueAndNotify() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const today = new Date().toDateString();
  if (localStorage.getItem("pa_notified") === today) return;
  const due = store.plants.filter(p => daysUntilWater(p) <= 0);
  if (due.length) {
    try {
      navigator.serviceWorker?.ready.then(reg => reg.showNotification("PlantApp 💧", {
        body: due.length === 1 ? `${due[0].name} czeka na podlanie!` : `${due.length} rośliny czekają na podlanie: ${due.map(p => p.name).join(", ")}`,
        icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "watering"
      }));
      localStorage.setItem("pa_notified", today);
    } catch { /* brak wsparcia */ }
  }
}

// ============ START ============
function init() {
  const intro = $("#leaf-intro");
  if (intro) {
    if (sessionStorage.getItem("pa_intro")) intro.classList.add("skip");
    else { sessionStorage.setItem("pa_intro", "1"); setTimeout(() => intro.remove(), 2400); }
  }
  $("#api-key").value = store.apiKey;
  $("#home-select")?.addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "__add_home") {
      const name = prompt("Nazwa miejsca (np. „Mieszkanie w Krakowie”):");
      if (name !== null) { const home = addHome(name, prompt("Adres (opcjonalnie):") || ""); if (home) toast("Dodano miejsce"); }
    } else if (v === "__edit_home") {
      const home = currentHome();
      const name = prompt("Nazwa miejsca:", home.name);
      if (name !== null && renameHome(home.id, name, prompt("Adres (opcjonalnie):", home.address || "") || "")) toast("Zapisano miejsce");
    } else {
      store.currentHomeId = v;
      store.currentRoomId = "";
    }
    renderPlants();
  });
  $("#room-chips")?.addEventListener("click", (e) => {
    const c = e.target.closest(".chip"); if (!c) return;
    const action = c.dataset.action;
    if (action === "add-room") {
      const name = prompt("Nazwa pokoju (np. „Salon”):");
      if (name !== null) { const room = addRoom(name); if (room) { store.currentRoomId = room.id; toast("Dodano pokój"); } }
    } else if (action === "rename-room") {
      const room = store.rooms.find(r => r.id === store.currentRoomId);
      const name = prompt("Nowa nazwa pokoju:", room?.name || "");
      if (name !== null && renameRoom(store.currentRoomId, name)) toast("Zmieniono nazwę pokoju");
    } else if (action === "delete-room") {
      const room = store.rooms.find(r => r.id === store.currentRoomId);
      if (room && confirm(`Usunąć pusty pokój „${room.name}”?`) && deleteRoom(room.id)) toast("Usunięto pokój");
    } else {
      store.currentRoomId = c.dataset.room || "";
    }
    renderPlants();
  });
  renderSymptoms();
  renderPlants();
  renderDoctorPlantPicker();
  renderUsage();
  updateKeyWarnings();
  checkDueAndNotify();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
