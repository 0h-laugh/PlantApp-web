/* PlantApp v1.1 — dziennik per roślina, Doktor przypisany do rośliny, ewolucja w czasie. */
"use strict";

// ============ STAN ============
const store = {
  get plants() { return JSON.parse(localStorage.getItem("pa_plants") || "[]"); },
  set plants(v) {
    try { localStorage.setItem("pa_plants", JSON.stringify(v)); }
    catch (e) { toast("Pamięć pełna — usuń stare zdjęcia z dziennika lub włącz synchronizację"); }
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


function cloudSettings() { return window.PlantAppCloud || null; }
function settingsLoaded() { return !!cloudSettings()?.isSettingsLoaded?.(); }
function hasPlantNetAccess() { return !!cloudSettings()?.hasPlantNetAccess?.(); }
function plantNetUnavailableMessage() {
  const cloud = cloudSettings();
  if (!cloud) return "Ładuję konfigurację chmury…";
  if (cloud.getSettingsError?.()) return cloud.getSettingsError();
  if (!cloud.isConfigured?.()) return "Backend Supabase nie jest skonfigurowany — najpierw wygeneruj config.js.";
  if (!settingsLoaded()) return "Pobieram konfigurację z chmury…";
  return "Najpierw dodaj klucz Pl@ntNet w Ustawieniach. Klucz jest przechowywany w chmurze.";
}
async function fetchPlantNet(kind, formData, options) {
  const cloud = cloudSettings();
  if (!cloud) throw new Error("Chmura nie jest jeszcze gotowa — spróbuj ponownie za chwilę.");
  if (kind === "identify") return cloud.identifyPlant(formData, options);
  return cloud.identifyDisease(formData, options);
}

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
const DEVICE_KEY = "pa_device_id";
function deviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) { id = "local-" + uid(); localStorage.setItem(DEVICE_KEY, id); }
  return id;
}
function currentJournalAuthor() {
  const u = window.PA_USER || null;
  return {
    userId: u?.id || null,
    userEmail: u?.email || null,
    displayName: u?.displayName || u?.email || (u ? "użytkownik" : "local"),
    sourceDevice: deviceId(),
  };
}

function isSummer() { const m = new Date().getMonth() + 1; return m >= 4 && m <= 9; }
function fmtDate(t) { return new Date(t).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: new Date(t).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined }); }
function fmtWhen(t) {
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startThat = new Date(t); startThat.setHours(0, 0, 0, 0);
  const diff = Math.round((startToday - startThat) / DAY);
  if (diff === 0) return "dzisiaj";
  if (diff === 1) return "wczoraj";
  if (diff > 1 && diff < 7) return diff + " dni temu";
  return fmtDate(t);
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

// ============ MOTYW (Nocna oranżeria / Jasna szklarnia) ============
const Theme = {
  KEY: "pa:theme",
  apply(t) {
    const theme = t === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === "light" ? "#F4F2EA" : "#0C1410";
    localStorage.setItem(Theme.KEY, theme);
    document.querySelectorAll("[data-theme-pick]").forEach(b =>
      b.classList.toggle("active", b.dataset.themePick === theme));
  },
  init() {
    Theme.apply(localStorage.getItem(Theme.KEY) || "dark");
    document.querySelectorAll("[data-theme-pick]").forEach(b =>
      b.addEventListener("click", () => Theme.apply(b.dataset.themePick)));
  },
};
Theme.init();

// ============ IKONY SVG (stroke, currentColor) — zamiast emoji ============
const ICONS = {
  drop: '<path d="M12 3.5 C 8 8, 6 11, 6 14.5 a6 6 0 0 0 12 0 C 18 11, 16 8, 12 3.5 Z"/>',
  leaf: '<path d="M12 21 C 5.5 17, 4.5 9.5, 12 3.5 C 19.5 9.5, 18.5 17, 12 21 Z M12 20 L 12 7"/>',
  sprout: '<path d="M12 20 V11"/><path d="M12 13 C 12 9.5 9.2 7.5 5.5 7.5 C 5.5 11 8.3 13 12 13 Z"/><path d="M12 11 C 12 8 14.5 6.2 18 6.2 C 18 9.2 15.5 11 12 11 Z"/>',
  cross: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8 v8 M8 12 h8"/>',
  camera: '<path d="M3 9 a1 1 0 0 1 1-1 h2.5 L8 6 h8 l1.5 2 H20 a1 1 0 0 1 1 1 v8 a1 1 0 0 1-1 1 H4 a1 1 0 0 1-1-1 Z"/><circle cx="12" cy="13" r="3.2"/>',
  note: '<path d="M6 3 h8 l4 4 v14 H6 Z M14 3 v4 h4"/><path d="M9 12 h6 M9 16 h4"/>',
  pencil: '<path d="M4 20 l1-4 L15.5 5.5 a2.1 2.1 0 0 1 3 3 L8 19 Z M13.5 7.5 l3 3"/>',
  pin: '<path d="M12 21 C 7 15.5 5.5 12.5 5.5 9.5 a6.5 6.5 0 0 1 13 0 C 18.5 12.5 17 15.5 12 21 Z"/><circle cx="12" cy="9.5" r="2.3"/>',
  warn: '<path d="M12 4 L21 19 H3 Z"/><path d="M12 10 v4"/><path d="M12 16.6 v.2"/>',
  sun: '<circle cx="12" cy="12" r="3.7"/><path d="M12 3 v2.2 M12 18.8 V21 M3 12 h2.2 M18.8 12 H21 M5.6 5.6 l1.6 1.6 M16.8 16.8 l1.6 1.6 M18.4 5.6 l-1.6 1.6 M7.2 16.8 l-1.6 1.6"/>',
  wind: '<path d="M4 9 h9 a2.4 2.4 0 1 0-2.4-2.4 M4 13 h13 a2.4 2.4 0 1 1-2.4 2.4 M4 17 h6.5"/>',
  bulb: '<path d="M9.2 17.5 h5.6 M10.2 20.5 h3.6 M12 3.5 a6 6 0 0 1 4 10.4 c-.7.7-1 1.4-1 2.1 H9 c0-.7-.3-1.4-1-2.1 a6 6 0 0 1 4-10.4 Z"/>',
  book: '<path d="M5.5 5 a2 2 0 0 1 2-2 H18 v14 H7.5 a2 2 0 0 0-2 2 Z M18 17 H7.5 a2 2 0 0 0-2 2"/>',
  sync: '<path d="M20 11 a8 8 0 0 0-13.7-4.6 L4 8 M4 4 v4 h4 M4 13 a8 8 0 0 0 13.7 4.6 L20 16 M20 20 v-4 h-4"/>',
  bell: '<path d="M6 16.5 v-5 a6 6 0 0 1 12 0 v5 l1.6 1.8 H4.4 Z M9.7 20 a2.3 2.3 0 0 0 4.6 0"/>',
  cloud: '<path d="M7 18 h9.5 a3.5 3.5 0 0 0 .4-7 A5 5 0 0 0 7.4 9.7 A3.6 3.6 0 0 0 7 18 Z"/>',
  spark: '<path d="M12 3.5 l1.7 4.8 L18.5 10 l-4.8 1.7 L12 16.5 l-1.7-4.8 L5.5 10 l4.8-1.7 Z"/>',
  house: '<path d="M4 11 L12 4 l8 7 M6 9.6 V19 h12 V9.6"/>',
  dry: '<circle cx="12" cy="8.5" r="3.3"/><path d="M4 16.5 q2-1.8 4 0 t4 0 t4 0 M4 19.5 q2-1.8 4 0 t4 0 t4 0"/>',
  scan: '<path d="M4 8 V5.5 A1.5 1.5 0 0 1 5.5 4 H8 M16 4 h2.5 A1.5 1.5 0 0 1 20 5.5 V8 M20 16 v2.5 A1.5 1.5 0 0 1 18.5 20 H16 M8 20 H5.5 A1.5 1.5 0 0 1 4 18.5 V16 M12 15.5 a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7 Z"/>',
};
function icon(name, size = 18, cls = "") {
  const path = ICONS[name];
  if (!path) return "";
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function entryPhotos(entry) {
  if (Array.isArray(entry.photos)) return entry.photos.filter(Boolean);
  return entry.photo ? [entry.photo] : [];
}
function normalizeJournalEntry(entry) {
  const t = entry.t || entry.createdAt || Date.now();
  const photos = entryPhotos(entry);
  return {
    id: entry.id || uid(),
    title: entry.title || "",
    text: entry.text || "",
    updatedAt: entry.updatedAt || t,
    userId: null,
    userEmail: null,
    displayName: "local",
    ...entry,
    t,
    photos,
    photo: entry.photo || photos[0],
  };
}


// Collapse duplicate journal entries by content (same key as cloud.js merge). Legacy data
// accumulated ~1 copy per sync because the old merge keyed on a volatile per-device id.
function journalContentKey(e) {
  const photo = e.photo || (Array.isArray(e.photos) ? e.photos[0] : "") || "";
  return [e.type || "", e.t || "", e.title || "", e.text || "", e.name || "", e.score || "", e.src || "", photo].join("|");
}
function dedupeJournal(journal) {
  const seen = new Map();
  for (const e of journal || []) {
    const k = journalContentKey(e);
    if (!seen.has(k)) seen.set(k, e);
  }
  return [...seen.values()].sort((x, y) => (Number(x.t) || 0) - (Number(y.t) || 0));
}

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
  const legacyAuthor = { userId: null, userEmail: null, displayName: "local" };
  plants.forEach(p => {
    if (!p.journal) {
      p.journal = [{ t: p.added || Date.now(), type: "added", ...legacyAuthor }];
      (p.history || []).forEach(t => p.journal.push({ t, type: "water", ...legacyAuthor }));
      delete p.history;
      changed = true;
    }
    if (!p.homeId || !store.homes.some(h => h.id === p.homeId)) { p.homeId = def.homeId; changed = true; }
    if (!p.roomId || !rooms.some(r => r.id === p.roomId && r.homeId === p.homeId)) { p.roomId = def.roomId; changed = true; }
    const normalized = dedupeJournal((p.journal || []).map(e => normalizeJournalEntry(e)));
    if (JSON.stringify(normalized) !== JSON.stringify(p.journal || [])) {
      p.journal = normalized;
      changed = true;
    }
  });
  if (changed) store.plants = plants;
})();

// ============ DZIENNIK ============
function addJournal(plantId, entry) {
  const plants = store.plants;
  const p = plants.find(x => x.id === plantId);
  if (!p) return false;
  const now = Date.now();
  p.journal = p.journal || [];
  const journalEntry = normalizeJournalEntry({ t: now, updatedAt: now, ...currentJournalAuthor(), ...entry });
  p.journal.push(journalEntry);
  p.updatedAt = now;
  if (entry.type === "water") p.lastWatered = journalEntry.t;
  if (entry.type === "fert") p.lastFertilized = journalEntry.t;
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

  if (d <= 0) out.push({ prio: 0, ico: "drop", text: `Podlej dziś${d < 0 ? ` — spóźnienie ${-d} ${-d === 1 ? "dzień" : "dni"}` : ""}.` });

  // dyscyplina podlewania: realny rytm z dziennika vs plan
  const waters = j.filter(e => e.type === "water").map(e => e.t).sort((a, b) => a - b);
  if (waters.length >= 4) {
    const gaps = waters.slice(1).map((t, i) => (t - waters[i]) / DAY);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (avg < interval * 0.65) out.push({ prio: 1, ico: "warn", text: `Podlewasz średnio co ${avg.toFixed(1)} dnia przy planie co ${interval} — ryzyko przelania. Sprawdzaj palcem 2–3 cm ziemi przed podlaniem.` });
    else if (avg > interval * 1.45) out.push({ prio: 1, ico: "dry", text: `Realny rytm to co ~${Math.round(avg)} dni przy planie co ${interval} — roślina bywa przesuszana. Skróć odstępy albo dostosuj plan przyciskiem ±.` });
  }

  // kontrola po diagnozie
  const diag = lastDiagnosis(p);
  if (diag) {
    const days = Math.floor((Date.now() - diag.t) / DAY);
    if (days >= 3 && days <= 21) {
      const act = diagAction(diag.name);
      out.push({ prio: 0, ico: "cross", text: `${days} dni po diagnozie „${diag.name}” — sprawdź, czy objawy ustępują.${act ? " Przypomnienie: " + act.split(".")[0] + "." : ""} Jeśli nie ma poprawy, zrób kontrolne zdjęcie w Doktorze.` });
    }
  }

  if (f !== null && f <= 0) out.push({ prio: 1, ico: "leaf", text: "Czas nawieźć — ostatnie nawożenie ponad miesiąc temu w sezonie wzrostu." });
  if (!isSummer() && /wysok/i.test(care.humidity)) out.push({ prio: 2, ico: "wind", text: "Sezon grzewczy + roślina lubiąca wilgoć: zraszaj lub dostaw nawilżacz, obserwuj końcówki liści." });

  const photos = j.filter(e => entryPhotos(e).length);
  const lastPhoto = Math.max(p.added || 0, ...photos.map(e => e.t));
  if (Date.now() - lastPhoto > 30 * DAY) out.push({ prio: 3, ico: "camera", text: "Ponad miesiąc bez zdjęcia — dodaj jedno do ewolucji, łatwiej wychwycisz powolne zmiany." });

  return out.sort((a, b) => a.prio - b.prio);
}
function allInsights(limit = 4) {
  const items = [];
  filteredPlants().forEach(p => plantInsights(p).forEach(i => items.push({ ...i, plant: p })));
  return items.sort((a, b) => a.prio - b.prio).slice(0, limit);
}

// ============ AI ASYSTENT ROŚLINY ============
const ASSISTANT_STORAGE_KEY = "pa_assistant_messages";
const ASSISTANT_SYSTEM_PROMPT = `Jesteś przyjaznym asystentem pielęgnacji roślin domowych w aplikacji PlantApp.
Odpowiadasz po polsku, zwięźle i praktycznie. Otrzymujesz kontekst JSON konkretnej rośliny:
gatunek, dziennik (podlewania, nawożenia, diagnozy, notatki), harmonogram i wskazówki pielęgnacyjne.
Opieraj porady na tym kontekście — odwołuj się do konkretnych wpisów z dziennika, gdy to pomaga.
Możesz też luźno rozmawiać o roślinie. Nie stawiasz diagnoz medycznych ani laboratoryjnych;
przy poważnych objawach sugeruj tryb "Doktor" w aplikacji. Nie używaj formatowania Markdown —
zwykły tekst, maksymalnie kilka zdań, chyba że użytkownik prosi o więcej.`;
// Dostawcy zgodni z API OpenAI (chat/completions), wołani wprost z przeglądarki.
const ASSISTANT_PROVIDERS = {
  openrouter: { label: "OpenRouter (darmowe modele)", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-oss-120b:free", keyUrl: "https://openrouter.ai/keys" },
  groq: { label: "Groq (darmowy limit)", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", keyUrl: "https://console.groq.com/keys" },
  custom: { label: "Własny adres (OpenAI-compatible)", baseUrl: "", model: "", keyUrl: "" },
};
function resolveAssistantConfig(cfg) {
  if (!cfg) return null;
  const preset = ASSISTANT_PROVIDERS[cfg.provider] || ASSISTANT_PROVIDERS.custom;
  // Tolerate users (or older saved configs) that pasted the full endpoint into baseUrl:
  // strip a trailing /chat/completions and any trailing slashes so we never double it.
  const baseUrl = (cfg.baseUrl || preset.baseUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/+$/, "");
  const model = cfg.model || preset.model;
  if (!baseUrl || !model || !cfg.apiKey) return null;
  return { baseUrl, model, apiKey: cfg.apiKey };
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function callAssistantLLM(cfg, context, history) {
  const messages = [
    { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
    { role: "user", content: `Kontekst rośliny (JSON):\n${JSON.stringify(context)}` },
    ...history,
  ];
  // Free models are frequently throttled upstream with a short retry-after; retry a few
  // times before surfacing the error so a transient 429 doesn't break the conversation.
  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${cfg.apiKey}`,
        "HTTP-Referer": location.origin,
        "X-Title": "PlantApp",
      },
      body: JSON.stringify({ model: cfg.model, max_tokens: 1024, messages }),
    });
    if (res.ok) {
      const data = await res.json();
      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) throw new Error("Dostawca AI nie zwrócił odpowiedzi.");
      return String(reply).trim();
    }
    let detail = ""; try { detail = (await res.json())?.error?.message || ""; } catch {}
    if (res.status === 401 || res.status === 403) throw new Error("Klucz API asystenta odrzucony — sprawdź go w Ustawieniach → Asystent AI.");
    if (res.status === 429) {
      if (attempt < MAX_ATTEMPTS) { await sleep(1200 * attempt); continue; }
      throw new Error("Darmowy model jest chwilowo przeciążony — spróbuj ponownie za moment lub zmień model/dostawcę w Ustawieniach.");
    }
    throw new Error(`Błąd dostawcy AI (${res.status}${detail ? ": " + detail : ""}).`);
  }
  throw new Error("Dostawca AI nie odpowiedział — spróbuj ponownie.");
}
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
        <div class="sec-k">${icon("spark",16)} AI asystent</div>
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
    const history = assistantMessages(plantId).slice(-10).map(m => ({ role: m.role, content: m.content }));
    const cfg = resolveAssistantConfig(await window.PlantAppCloud?.getAssistantConfig?.());
    let reply;
    if (cfg) {
      reply = await callAssistantLLM(cfg, context, history);
    } else {
      // brak konfiguracji w aplikacji — spróbuj opcjonalnej Edge Function
      const sb = getAssistantClient();
      if (!sb) throw new Error("Skonfiguruj asystenta w Ustawieniach → Asystent AI (darmowy klucz OpenRouter lub Groq).");
      const { data, error } = await sb.functions.invoke("plant-assistant", { body: { plantId, message, context, history } });
      if (error) throw new Error("Skonfiguruj asystenta w Ustawieniach → Asystent AI (darmowy klucz OpenRouter lub Groq).");
      reply = data?.reply || data?.message || data?.content;
      if (!reply) throw new Error("Backend AI nie zwrócił odpowiedzi.");
    }
    const assistantMessage = addAssistantMessage(plantId, "assistant", reply);
    await saveAssistantMessageToSupabase(plantId, assistantMessage, context);
  } catch (err) {
    const fallback = "Nie mogę teraz odpowiedzieć. Wejdź w Ustawienia → Asystent AI i dodaj darmowy klucz (OpenRouter lub Groq).";
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
const NAV_VIEWS = new Set(["plants", "scan", "doctor", "settings", "plant-detail"]);
const VIEW_ANIMATION_CLASSES = ["view-enter-forward", "view-exit-forward", "view-enter-back", "view-exit-back"];
let currentView = document.querySelector(".view.active")?.id.replace("view-", "") || "plants";
let currentPlantId = null;
let navStack = [currentView];
let navIndex = 0;
let isApplyingHistoryState = false;

function navUrl(view, state = {}) {
  const params = new URLSearchParams();
  params.set("view", view);
  if (view === "plant-detail" && state.plantId) params.set("plant", state.plantId);
  return `${location.pathname}${location.search}#${params.toString()}`;
}
function makeNavState(view, index = navIndex, state = {}) {
  return { view, navIndex: index, plantId: state.plantId || null };
}
function syncHistoryState(view = currentView, state = {}) {
  if (!NAV_VIEWS.has(view) || !("history" in window)) return;
  history.replaceState(makeNavState(view, navIndex, state), "", navUrl(view, state));
}
function animateViewChange(fromEl, toEl, direction) {
  if (!toEl || fromEl === toEl) return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    fromEl?.classList.remove(...VIEW_ANIMATION_CLASSES);
    toEl.classList.remove(...VIEW_ANIMATION_CLASSES);
    return;
  }
  const dir = direction === "back" ? "back" : "forward";
  const enterClass = `view-enter-${dir}`;
  const exitClass = `view-exit-${dir}`;
  fromEl?.classList.remove(...VIEW_ANIMATION_CLASSES);
  toEl.classList.remove(...VIEW_ANIMATION_CLASSES);
  if (fromEl) {
    fromEl.classList.add(exitClass);
    fromEl.addEventListener("animationend", () => fromEl.classList.remove(exitClass), { once: true });
  }
  toEl.classList.add(enterClass);
  toEl.addEventListener("animationend", () => toEl.classList.remove(enterClass), { once: true });
}
function applyViewSideEffects(view) {
  if (view === "plants") renderPlants();
  if (view === "doctor") renderDoctorPlantPicker();
  if (view === "scan" || view === "doctor") updateKeyWarnings();
}
function goto(view, options = {}) {
  if (!NAV_VIEWS.has(view)) return;
  const target = $("#view-" + view);
  if (!target) return;

  const fromView = currentView;
  const fromEl = $("#view-" + fromView);
  const direction = options.direction || "forward";
  const state = options.state || {};
  const previousPlantId = currentPlantId;

  if (view === "plant-detail") currentPlantId = state.plantId || currentPlantId;
  else currentPlantId = null;
  const isSameDestination = fromView === view && previousPlantId === currentPlantId;

  if (fromView !== view) animateViewChange(fromEl, target, direction);
  const navView = view === "plant-detail" ? "plants" : view;
  $$(".view").forEach(v => v.classList.toggle("active", v === target));
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.goto === navView));
  $$(".side-link").forEach(t => t.classList.toggle("active", t.dataset.goto === navView));
  document.body.classList.toggle("on-plants", view === "plants");
  currentView = view;
  window.scrollTo(0, 0);
  applyViewSideEffects(view);

  if (!isSameDestination && !isApplyingHistoryState && !options.skipHistory && "history" in window) {
    if (options.replace) {
      history.replaceState(makeNavState(view, navIndex, { plantId: currentPlantId }), "", navUrl(view, { plantId: currentPlantId }));
      navStack[navIndex] = view;
    } else {
      navStack = navStack.slice(0, navIndex + 1);
      navStack.push(view);
      navIndex = navStack.length - 1;
      history.pushState(makeNavState(view, navIndex, { plantId: currentPlantId }), "", navUrl(view, { plantId: currentPlantId }));
    }
  }
}
function applyHistoryState(state) {
  const view = state?.view && NAV_VIEWS.has(state.view) ? state.view : "plants";
  const targetIndex = typeof state?.navIndex === "number" ? state.navIndex : 0;
  const direction = targetIndex < navIndex ? "back" : "forward";
  navIndex = Math.max(0, targetIndex);
  navStack = navStack.slice(0, navIndex + 1);
  navStack[navIndex] = view;

  isApplyingHistoryState = true;
  if (view === "plant-detail") {
    if (state?.plantId) openDetail(state.plantId, { direction, skipHistory: true });
    else goto("plants", { direction, skipHistory: true });
  } else {
    goto(view, { direction, skipHistory: true });
  }
  isApplyingHistoryState = false;
}
window.addEventListener("popstate", (e) => applyHistoryState(e.state));

document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (!g) return;
  e.preventDefault();
  const direction = g.classList.contains("back-btn") ? "back" : "forward";
  if (g.classList.contains("back-btn") && history.state?.navIndex > 0) {
    history.back();
    return;
  }
  goto(g.dataset.goto, { direction });
});

syncHistoryState(currentView);

let swipeBackStart = null;
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" || e.clientX > 24) return;
  swipeBackStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
window.addEventListener("pointermove", (e) => {
  if (!swipeBackStart || e.pointerId !== swipeBackStart.id) return;
  const dx = e.clientX - swipeBackStart.x;
  const dy = Math.abs(e.clientY - swipeBackStart.y);
  if (dx > 12 && dx > dy) e.preventDefault();
}, { passive: false });
window.addEventListener("pointerup", (e) => {
  if (!swipeBackStart || e.pointerId !== swipeBackStart.id) return;
  const dx = e.clientX - swipeBackStart.x;
  const dy = Math.abs(e.clientY - swipeBackStart.y);
  swipeBackStart = null;
  if (dx > 80 && dy < 70) {
    if (history.state?.navIndex > 0) history.back();
    else if (currentView !== "plants") goto("plants", { direction: "back" });
  }
});
window.addEventListener("pointercancel", () => { swipeBackStart = null; });

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
    <div class="ring-label">${overdue ? icon("drop", Math.round(size*0.34)) : daysLeft}<small>${overdue ? "dziś" : (daysLeft === 1 ? "dzień" : "dni")}</small></div>
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

// ============ LISTA ROŚLIN (wiersze + karta „Dzisiaj") ============
function greeting() {
  const h = new Date().getHours();
  if (h < 6) return "Dobranoc";
  if (h < 12) return "Dzień dobry";
  if (h < 18) return "Miłego dnia";
  return "Dobry wieczór";
}
function userInitials() {
  const u = window.PA_USER;
  const src = u?.displayName || u?.email || "";
  const letters = src.replace(/[^A-Za-zŻŹĆĄŚĘŁÓŃżźćąśęłóń]/g, " ").trim().split(/\s+/).filter(Boolean);
  if (letters.length >= 2) return (letters[0][0] + letters[1][0]).toUpperCase();
  if (letters.length === 1) return letters[0].slice(0, 2).toUpperCase();
  return "PA";
}
// mini-pierścień na wierszu rośliny: wypełnia się w miarę zbliżania terminu podlania
function miniRingSVG(plant) {
  const interval = currentInterval(plant);
  const daysLeft = daysUntilWater(plant);
  const due = daysLeft <= 0;
  const C = 75.398; // 2π·12
  const elapsed = Math.max(0.04, Math.min(1, (interval - daysLeft) / interval));
  const len = C * elapsed;
  const label = due ? "0d" : daysLeft + "d";
  return `<div class="mini-ring ${due ? "due" : ""}">
    <svg width="36" height="36" viewBox="0 0 30 30">
      <circle class="mr-track" cx="15" cy="15" r="12" fill="none" stroke-width="3"/>
      <circle class="mr-bar" cx="15" cy="15" r="12" fill="none" stroke-width="3" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}"/>
    </svg>
    <div class="mr-label">${label}</div>
  </div>`;
}
function todayRingSVG(cared, total) {
  const C = 263.894; // 2π·42
  const frac = total ? cared / total : 0;
  const len = Math.max(0.04 * C, C * frac);
  return `<svg width="76" height="76" viewBox="0 0 100 100">
    <circle class="tr-track" cx="50" cy="50" r="42" fill="none" stroke-width="8"/>
    <circle class="tr-bar" cx="50" cy="50" r="42" fill="none" stroke-width="8" stroke-dasharray="${len.toFixed(1)} ${(C - len).toFixed(1)}"/>
  </svg>`;
}
function quickWater(plantId) {
  const p = store.plants.find(x => x.id === plantId);
  if (!p) return;
  addJournal(plantId, { type: "water" });
  toast(`Podlano: ${p.name} ✓`);
  renderPlants();
}
function quickFert(plantId) {
  const p = store.plants.find(x => x.id === plantId);
  if (!p) return;
  addJournal(plantId, { type: "fert" });
  toast(`Nawieziono: ${p.name} ✓`);
  renderPlants();
}
function pl(n, one, few, many) { return n === 1 ? one : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? few : many; }

function renderTodayCard(plants) {
  const box = $("#today-card");
  if (!box) return;
  if (!plants.length) { box.innerHTML = ""; return; }
  const waterDue = plants.filter(p => daysUntilWater(p) <= 0).sort((a, b) => daysUntilWater(a) - daysUntilWater(b));
  const fertDue = plants.filter(p => { const f = daysUntilFert(p); return f !== null && f <= 0; });
  const pendingIds = new Set([...waterDue, ...fertDue].map(p => p.id));
  const total = plants.length;
  const cared = total - pendingIds.size;

  if (!pendingIds.size) {
    box.innerHTML = `<div class="today-card"><div class="today-allok">
      <div class="ok-badge">✓</div>
      <div><div class="today-title">Wszystko zadbane</div>
      <div class="today-desc">Żadna roślina nie czeka dziś na podlanie ani nawożenie.</div></div>
    </div></div>`;
    return;
  }

  const taskRows = [
    ...waterDue.map(p => ({ p, kind: "water" })),
    ...fertDue.filter(p => daysUntilWater(p) > 0).map(p => ({ p, kind: "fert" })),
  ].slice(0, 6);

  const n = pendingIds.size;
  box.innerHTML = `<div class="today-card">
    <div class="today-head">
      <div class="today-ring">${todayRingSVG(cared, total)}
        <div class="tr-center"><div class="tr-num">${cared}/${total}</div><div class="tr-k">zadbane</div></div>
      </div>
      <div style="flex:1">
        <div class="today-title">${n} ${pl(n, "zadanie", "zadania", "zadań")} na dziś</div>
        <div class="today-desc">Odhacz jednym dotknięciem — zapiszę w dzienniku.</div>
      </div>
    </div>
    <div class="today-tasks">
      ${taskRows.map(({ p, kind }) => `
        <div class="today-task">
          ${p.photo ? `<img src="${p.photo}" alt="" loading="lazy">` : `<div class="tt-ph"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 21 C 5.5 17, 4.5 9.5, 12 3.5 C 19.5 9.5, 18.5 17, 12 21 Z M12 20 L 12 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>`}
          <div class="tt-info">
            <div class="tt-name">${esc(p.name)}</div>
            <div class="tt-sub">${kind === "water" ? "Podlewanie · co " + currentInterval(p) + " dni" : "Nawożenie · sezon wzrostu"}</div>
          </div>
          <button class="tt-btn ${kind === "water" ? "tt-water" : "tt-fert"}" data-${kind}="${p.id}">${kind === "water" ? "Podlej" : "Nawieź"}</button>
        </div>`).join("")}
    </div>
  </div>`;
  box.querySelectorAll("[data-water]").forEach(b => b.onclick = () => quickWater(b.dataset.water));
  box.querySelectorAll("[data-fert]").forEach(b => b.onclick = () => quickFert(b.dataset.fert));
}

function renderPlants() {
  renderPlaceControls();
  const plants = filteredPlants();
  const allPlants = store.plants;
  const list = $("#plants-list"), empty = $("#plants-empty"), banner = $("#due-banner");
  list.innerHTML = "";
  empty.classList.toggle("hidden", allPlants.length > 0);

  // hero: data + awatar + powitanie
  const hd = $("#hero-date"), hl = $("#hero-line"), av = $("#hero-avatar");
  if (hd) hd.textContent = new Date().toLocaleDateString("pl-PL", { weekday: "long", day: "numeric", month: "long" });
  if (av) av.textContent = userInitials();
  if (hl) {
    if (!allPlants.length) hl.textContent = "Zacznij od pierwszego skanu";
    else hl.textContent = greeting();
  }

  renderTodayCard(plants);
  banner.classList.add("hidden"); // baner zastąpiony przez kartę „Dzisiaj" + Asystenta

  // Asystent — wnioski z dziennika
  const aBox = $("#assistant-box");
  if (aBox) {
    const ins = allInsights(4);
    if (!ins.length) { aBox.classList.add("hidden"); aBox.innerHTML = ""; }
    else {
      aBox.classList.remove("hidden");
      aBox.innerHTML = `<div class="as-head"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 21 C 5.5 17, 4.5 9.5, 12 3.5 C 19.5 9.5, 18.5 17, 12 21 Z" fill="none" stroke="currentColor" stroke-width="1.7"/></svg> Asystent</div>`
        + ins.map(i => `<button class="as-item" data-plant="${i.plant.id}">
            <span class="as-ico">${icon(i.ico)}</span>
            <span class="as-txt"><strong>${esc(i.plant.name)}:</strong> ${esc(i.text)}</span>
          </button>`).join("");
      aBox.querySelectorAll("[data-plant]").forEach(b => b.onclick = () => openDetail(b.dataset.plant));
    }
  }

  plants.slice().sort((a, b) => daysUntilWater(a) - daysUntilWater(b)).forEach((p) => {
    const d = daysUntilWater(p);
    const el = document.createElement("div");
    el.className = "plant-row";
    el.innerHTML = `
      ${p.photo ? `<img class="pr-photo" src="${p.photo}" alt="" loading="lazy">` : `<div class="pr-photo"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M12 21 C 5.5 17, 4.5 9.5, 12 3.5 C 19.5 9.5, 18.5 17, 12 21 Z M12 20 L 12 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></div>`}
      <div class="pr-info">
        <div class="pr-name">${esc(p.name)}</div>
        <div class="pr-sub ${d <= 0 ? "due" : ""}">${esc(roomName(p.roomId))} · ${d <= 0 ? "podlej dziś" : "podlej za " + d + " " + pl(d, "dzień", "dni", "dni")}</div>
      </div>
      ${miniRingSVG(p)}`;
    el.addEventListener("click", () => openDetail(p.id));
    list.appendChild(el);
  });
}

// ============ SZCZEGÓŁY ROŚLINY: dziennik + ewolucja ============
function journalAuthor(e) { return e.displayName || e.userEmail || (e.userId ? "użytkownik" : "local"); }
const JOURNAL_META = {
  added: { ico: "sprout", label: e => `Dodał/a ${esc(journalAuthor(e))} do kolekcji` },
  water: { ico: "drop", label: e => `Podlał/a ${esc(journalAuthor(e))}` },
  fert: { ico: "leaf", label: e => `Nawiózł/a ${esc(journalAuthor(e))}` },
  diagnosis: { ico: "cross", label: e => `Diagnoza (${esc(journalAuthor(e))}): ${esc(e.name)}${e.score ? " (" + e.score + "%)" : ""}${e.src === "objawy" ? " — z objawów" : ""}` },
  photo: { ico: "camera", label: e => `Zdjęcie — ${esc(journalAuthor(e))}` },
  note: { ico: "note", label: e => `${esc(journalAuthor(e))}: ${esc(e.title || e.text || "Notatka")}` },
};

const NOTE_COLLAPSE_LIMIT = 180;
let noteContext = null;
let photoViewerOpen = false;
let suppressPhotoPop = false;

function renderTimelineEntry(e, i) {
  const m = JOURNAL_META[e.type] || { ico: "•", label: () => e.type };
  const photos = entryPhotos(e);
  const isNote = e.type === "note";
  const noteText = e.text || "";
  const longNote = isNote && noteText.length > NOTE_COLLAPSE_LIMIT;
  const title = e.title || (isNote ? "Notatka" : m.label(e));
  const label = isNote ? `
    <div class="tl-label">
      <strong class="tl-note-title">${esc(title)}</strong>
      <div class="tl-note-text ${longNote ? "collapsed" : ""}">${esc(noteText)}</div>
      <div class="tl-note-author">${esc(journalAuthor(e))}</div>
    </div>` : `<div class="tl-label">${m.label(e)}</div>`;
  return `<div class="tl-entry">
    <div class="tl-ico">${icon(m.ico, 16)}</div>
    <div class="tl-body">
      ${label}
      <div class="tl-date">${fmtWhen(e.t)}${e.updatedAt && e.updatedAt !== e.t ? " · edytowano " + fmtWhen(e.updatedAt) : ""}</div>
      ${photos.map(photo => `<img class="tl-thumb" src="${photo}" alt="" loading="lazy">`).join("")}
      ${isNote ? `<div class="tl-tools">${longNote ? `<button class="tl-more" type="button">Pokaż całość</button>` : ""}<button class="tl-edit" type="button" data-edit="${e.id}">Edytuj</button></div>` : ""}
    </div>
    <button class="tl-del" data-del="${i}" aria-label="Usuń wpis">✕</button>
  </div>`;
}

function openPhotoViewer(src) {
  const modal = $("#photo-viewer"), img = $("#photo-viewer-img");
  if (!modal || !img || !src) return;
  img.src = src;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  photoViewerOpen = true;
  if (!history.state || !history.state.photoViewer) history.pushState({ ...(history.state || {}), photoViewer: true }, "");
}
function closePhotoViewer(fromPop = false) {
  const modal = $("#photo-viewer"), img = $("#photo-viewer-img");
  if (!modal || modal.classList.contains("hidden")) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (img) img.src = "";
  document.body.classList.remove("modal-open");
  photoViewerOpen = false;
  if (!fromPop && history.state?.photoViewer) {
    suppressPhotoPop = true;
    history.back();
  }
}

function openNoteModal(plantId, entryId = null) {
  const modal = $("#note-modal"), form = $("#note-form");
  const titleInput = $("#note-title"), textInput = $("#note-text"), heading = $("#note-modal-title");
  if (!modal || !form || !titleInput || !textInput) return;
  const plant = store.plants.find(p => p.id === plantId);
  const entry = entryId ? (plant?.journal || []).find(e => e.id === entryId) : null;
  noteContext = { plantId, entryId };
  heading.textContent = entry ? "Edytuj notatkę" : "Dodaj notatkę";
  titleInput.value = entry?.title || "";
  textInput.value = entry?.text || "";
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  setTimeout(() => textInput.focus(), 0);
}
function closeNoteModal() {
  const modal = $("#note-modal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
  noteContext = null;
}

function openDetail(id, options = {}) {
  const p = store.plants.find(x => x.id === id);
  if (!p) { goto("plants", { direction: "back", replace: true }); return; }
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
  (p.journal || []).filter(e => entryPhotos(e).length).sort((a, b) => a.t - b.t).forEach(e => {
    entryPhotos(e).forEach(photo => evoPhotos.push({ t: e.t, photo, tag: e.type === "diagnosis" ? "diagnoza" : "" }));
  });

  $("#plant-detail-content").innerHTML = `
    <div class="detail-hero">
      ${p.photo ? `<img class="detail-photo" src="${p.photo}" alt="">` : `<div class="detail-photo">${icon("leaf", 34)}</div>`}
      <div>
        <div class="detail-name">${esc(p.name)}</div>
        <div class="detail-latin">${esc(p.latin || "")}</div>
        <div class="detail-latin detail-place">${icon("pin", 15)} ${esc(homeLabel(store.homes.find(h => h.id === p.homeId) || currentHome()))} · ${esc(roomName(p.roomId))}</div>
        ${care.toxic === true ? `<div style="color:var(--alert);font-size:.8rem;margin-top:4px" class="tox-line">${icon("warn",15)} Toksyczna dla zwierząt</div>` : care.toxic === false ? `<div style="color:var(--leaf);font-size:.8rem;margin-top:4px" class="tox-line">${icon("cross",15)} Bezpieczna dla zwierząt</div>` : ""}
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
        <button class="btn btn-water" id="water-now">${icon("drop")} Podlałem/am teraz</button>
      </div>
    </div>

    <div class="fert-block">
      <div class="fert-ico">${icon("leaf", 20)}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:.92rem">${fert === null ? "Nawożenie: przerwa zimowa" : fert <= 0 ? "Czas nawieźć!" : "Nawożenie za " + fert + " " + (fert === 1 ? "dzień" : "dni")}</div>
        <div class="muted" style="font-size:.78rem">${fert === null ? "Wznowisz w kwietniu — rośliny zimą odpoczywają." : "co " + FERT_INTERVAL + " dni w sezonie wzrostu"}</div>
      </div>
      ${fert !== null ? `<button class="btn btn-ghost" id="fert-now" style="padding:9px 14px">${icon("leaf")} Nawiozłem/am</button>` : ""}
    </div>

    ${(() => { const ins = plantInsights(p); return ins.length ? `
    <div class="card as-card">
      <div class="sec-k">Asystent</div>
      ${ins.map(i => `<div class="as-line"><span class="as-ico">${icon(i.ico, 16)}</span><span>${esc(i.text)}</span></div>`).join("")}
    </div>` : ""; })()}

    <div class="action-row">
      <label class="btn btn-ghost" for="journal-photo-file">${icon("camera")} Zdjęcie do dziennika<input type="file" id="journal-photo-file" accept="image/*" capture="environment" hidden></label>
      <button class="btn btn-ghost" id="add-note">${icon("note")} Notatka</button>
      <button class="btn btn-ghost" id="diagnose-this" data-goto="doctor">${icon("cross")} Diagnozuj</button>
    </div>

    ${evoPhotos.length > 1 ? `
    <div class="card">
      <div class="sec-k">${icon("leaf",15)} Ewolucja (${evoPhotos.length} zdjęć)</div>
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
        ${p.customInterval ? `<button class="btn btn-ghost" id="int-reset" style="padding:8px 12px;font-size:.8rem">${icon("sync",15)} auto</button>` : ""}
      </div>
    </div>

    <div class="care-grid">
      <div class="care-cell"><div class="k">${icon("sun",14)} Światło</div><div class="v">${esc(care.light)}</div></div>
      <div class="care-cell"><div class="k">${icon("wind",14)} Wilgotność</div><div class="v">${esc(care.humidity)}</div></div>
    </div>
    <div class="card"><div class="sec-k">${icon("bulb",15)} Wskazówki</div><div style="font-size:.9rem;line-height:1.55">${esc(care.tips)}</div></div>

    <div class="card">
      <div class="sec-k">${icon("book",15)} Dziennik (${journal.length})</div>
      ${journal.length ? `<div class="timeline">${journal.map((e, i) => renderTimelineEntry(e, i)).join("")}</div>` : `<p class="muted">Pusto. Podlej, dodaj zdjęcie albo zdiagnozuj — wszystko zapisze się tutaj.</p>`}
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
  $("#water-now").onclick = () => { addJournal(id, { type: "water" }); toast("Zapisano podlewanie"); openDetail(id); };
  const fertBtn = $("#fert-now");
  if (fertBtn) fertBtn.onclick = () => { addJournal(id, { type: "fert" }); toast("Zapisano nawożenie"); openDetail(id); };
  $("#add-note").onclick = () => openNoteModal(id);
  $("#journal-photo-file").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const photo = await blobToDataURL(await fileToCompressed(f, 420, 0.72));
    addJournal(id, { type: "photo", title: "Zdjęcie", photos: [photo], photo });
    toast("Dodano do dziennika"); openDetail(id);
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
  $$("#plant-detail-content .tl-more").forEach(btn => btn.onclick = () => {
    const text = btn.closest(".tl-body")?.querySelector(".tl-note-text");
    if (!text) return;
    const collapsed = text.classList.toggle("collapsed");
    btn.textContent = collapsed ? "Pokaż całość" : "Zwiń";
  });
  $$("#plant-detail-content .tl-edit").forEach(btn => btn.onclick = () => openNoteModal(id, btn.dataset.edit));
  $$("#plant-detail-content .detail-photo, #plant-detail-content .evo-item img, #plant-detail-content .tl-thumb").forEach(img => {
    if (img.tagName === "IMG") img.addEventListener("click", (ev) => { ev.stopPropagation(); openPhotoViewer(img.currentSrc || img.src); });
  });
  $("#delete-plant").onclick = () => {
    if (confirm(`Usunąć „${p.name}" razem z dziennikiem?`)) {
      store.plants = store.plants.filter(x => x.id !== id);
      window.dispatchEvent(new CustomEvent("pa:delete", { detail: { id, userId: p._cloudUserId, homeId: p.homeId } }));
      toast("Usunięto"); goto("plants");
    }
  };
  goto("plant-detail", {
    direction: options.direction || "forward",
    skipHistory: options.skipHistory,
    replace: options.replace || (currentView === "plant-detail" && currentPlantId === id),
    state: { plantId: id },
  });
  openAssistant(id);
}
function mutatePlant(id, fn) {
  const plants = store.plants;
  const p = plants.find(x => x.id === id);
  if (p) { fn(p); p.updatedAt = Date.now(); store.plants = plants; }
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
  updateKeyWarnings();
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
    // PlantNet expects one "organs" form field per image; omitting it means "auto".
    if (organ && organ !== "auto") fd.append("organs", organ);
    const res = await fetchPlantNet("identify", fd, { lang: "pl", nbResults: 4 });
    if (res.status === 401 || res.status === 403) throw new Error("Klucz API odrzucony — sprawdź klucz i Authorized domains w panelu PlantNet.");
    if (res.status === 404) throw new Error("Nie rozpoznano rośliny. Spróbuj wyraźniejszego zdjęcia liścia lub kwiatu.");
    if (res.status === 429) throw new Error("Wyczerpany dzienny limit (500/dzień). Spróbuj jutro.");
    if (!res.ok) {
      let detail = ""; try { detail = (await res.json())?.message || ""; } catch {}
      throw new Error("Błąd serwera Pl@ntNet (" + res.status + (detail ? ": " + detail : "") + ").");
    }
    const data = await res.json();
    bumpUsage("identify", data.remainingIdentificationRequests);
    renderScanResults(data.results || []);
    st.classList.add("hidden");
  } catch (err) {
    st.classList.add("error");
    st.textContent = navigator.onLine ? (err.message || "Coś poszło nie tak.") : "Brak internetu — identyfikacja wymaga połączenia.";
  } finally { updateKeyWarnings(); }
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
        ${known ? `${icon("drop",14)} Podlewanie co ~${isSummer() ? care.waterSummer : care.waterWinter} dni · ${care.toxic ? "toksyczna" : care.toxic === false ? "bezpieczna dla zwierząt" : ""}` : "Brak w bazie pielęgnacji — dodam z ogólnym planem, dostroisz ręcznie."}
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
  plants.push({ id: uid(), homeId, roomId, name, latin, photo: scanThumb, added: Date.now(), updatedAt: Date.now(), lastWatered: Date.now(), journal: [normalizeJournalEntry({ t: Date.now(), type: "added", title: "Dodano do kolekcji", ...currentJournalAuthor() })] });
  store.plants = plants;
  toast("Dodano: " + name);
  scanBlob = null; scanThumb = null;
  $("#scan-preview").innerHTML = `<span class="photo-cta">${icon("camera",30)}<br>Dotknij, by zrobić zdjęcie</span>`;
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
  updateKeyWarnings();
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
    const res = await fetchPlantNet("disease", fd, { nbResults: 3 });
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
  } finally { updateKeyWarnings(); }
});

function saveDiagnosis(name, score, src) {
  if (!doctorPlantId) { toast("Wybierz roślinę u góry, żeby zapisać do dziennika"); return false; }
  const ok = addJournal(doctorPlantId, { type: "diagnosis", title: `Diagnoza: ${name}`, text: "", name, score, src, photos: src === "ai" && doctorThumb ? [doctorThumb] : [], photo: src === "ai" ? doctorThumb : undefined });
  if (ok) {
    const p = store.plants.find(x => x.id === doctorPlantId);
    toast(`Zapisano w dzienniku: ${p.name}`);
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
      <div class="result-actions"><button class="btn btn-primary">${icon("book")} Zapisz do dziennika</button></div>`;
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
        <div class="result-actions"><button class="btn btn-ghost" data-sym="${i}">${icon("book")} Zapisz do dziennika</button></div>
      </div>
    </details>`).join("");
  $$("#symptoms-list [data-sym]").forEach(b => b.onclick = () => {
    const s = SYMPTOMS_DB[Number(b.dataset.sym)];
    if (saveDiagnosis(s.label, null, "objawy")) { b.disabled = true; b.textContent = "✓ Zapisano"; }
  });
}

// ============ USTAWIENIA ============
function updateKeyWarnings() {
  const has = hasPlantNetAccess();
  const msg = plantNetUnavailableMessage();
  [$("#scan-keywarn"), $("#doctor-keywarn")].forEach(el => {
    el.classList.toggle("hidden", has);
    if (!has) el.innerHTML = `${esc(msg)} <a href="#" data-goto="settings">Ustawienia</a>`;
  });
  $("#scan-go").disabled = !(has && scanBlob);
  $("#doctor-go").disabled = !(has && doctorBlob);
}
async function refreshApiKeyField() {
  const cloud = cloudSettings();
  const input = $("#api-key");
  const status = $("#key-status");
  if (!cloud) { status.textContent = "Ładuję połączenie z chmurą…"; updateKeyWarnings(); return; }
  if (cloud.hasPlantNetProxy?.()) {
    input.value = "";
    input.placeholder = "Zapytania obsługuje Supabase Edge Function";
    status.textContent = "✓ Aktywny bezpieczniejszy wariant: zapytania idą przez Supabase Edge Function, więc sekret nie jest widoczny w przeglądarce.";
    updateKeyWarnings();
    return;
  }
  input.placeholder = "Wklej klucz API…";
  if (!cloud.isSettingsLoaded?.()) { status.textContent = "Pobieram klucz z chmury…"; updateKeyWarnings(); return; }
  if (cloud.getSettingsError?.()) { status.textContent = cloud.getSettingsError(); updateKeyWarnings(); return; }
  input.value = await cloud.getPlantNetApiKey?.() || "";
  status.textContent = input.value ? "✓ Klucz pobrany z chmury." : "Brak klucza w chmurze.";
  updateKeyWarnings();
}
$("#save-key").addEventListener("click", async () => {
  const cloud = cloudSettings();
  const v = $("#api-key").value.trim();
  if (!cloud?.savePlantNetApiKey) { $("#key-status").textContent = "Chmura nie jest jeszcze gotowa."; return; }
  $("#save-key").disabled = true;
  $("#key-status").textContent = "Zapisuję w chmurze…";
  try {
    await cloud.savePlantNetApiKey(v);
    $("#key-status").textContent = v ? "✓ Klucz zapisany w chmurze." : "Klucz usunięty z chmury.";
    updateKeyWarnings();
    toast(v ? "Klucz zapisany w chmurze" : "Klucz usunięty z chmury");
  } catch (err) {
    $("#key-status").textContent = err.message || "Nie udało się zapisać klucza.";
  } finally {
    $("#save-key").disabled = false;
  }
});
window.addEventListener("pa:settings", refreshApiKeyField);

// ---- konfiguracja asystenta AI (Ustawienia) ----
function fillAssistantProviderSelect() {
  const sel = $("#assistant-provider");
  if (!sel || sel.options.length) return;
  sel.innerHTML = Object.entries(ASSISTANT_PROVIDERS)
    .map(([id, p]) => `<option value="${id}">${esc(p.label)}</option>`).join("");
}
function syncAssistantProviderUI() {
  const sel = $("#assistant-provider");
  const preset = ASSISTANT_PROVIDERS[sel?.value] || ASSISTANT_PROVIDERS.custom;
  $("#assistant-custom-row").hidden = sel?.value !== "custom";
  $("#assistant-model").placeholder = preset.model ? `Model (domyślnie: ${preset.model})` : "Model (np. llama-3.3-70b)";
}
async function refreshAssistantConfigCard() {
  fillAssistantProviderSelect();
  const status = $("#assistant-config-status");
  const cloud = cloudSettings();
  if (!cloud) { status.textContent = "Ładuję połączenie z chmurą…"; return; }
  if (!cloud.isSettingsLoaded?.()) { status.textContent = "Pobieram konfigurację z chmury…"; return; }
  const cfg = await cloud.getAssistantConfig?.();
  if (cfg) {
    $("#assistant-provider").value = ASSISTANT_PROVIDERS[cfg.provider] ? cfg.provider : "custom";
    $("#assistant-key").value = cfg.apiKey || "";
    $("#assistant-model").value = cfg.model || "";
    $("#assistant-baseurl").value = cfg.baseUrl || "";
    status.textContent = resolveAssistantConfig(cfg) ? "✓ Asystent skonfigurowany — gotowy do rozmowy." : "Konfiguracja niepełna — uzupełnij klucz.";
  } else {
    status.textContent = "Brak konfiguracji — wybierz dostawcę i wklej darmowy klucz.";
  }
  syncAssistantProviderUI();
}
$("#assistant-provider")?.addEventListener("change", syncAssistantProviderUI);
$("#assistant-save")?.addEventListener("click", async () => {
  const cloud = cloudSettings();
  const status = $("#assistant-config-status");
  if (!cloud?.saveAssistantConfig) { status.textContent = "Chmura nie jest jeszcze gotowa — zaloguj się."; return; }
  const provider = $("#assistant-provider").value;
  const cfg = {
    provider,
    apiKey: $("#assistant-key").value.trim(),
    model: $("#assistant-model").value.trim(),
    // Only custom providers carry a base URL; presets resolve it from ASSISTANT_PROVIDERS,
    // so we never persist (and later re-append to) a full endpoint for openrouter/groq.
    baseUrl: provider === "custom" ? $("#assistant-baseurl").value.trim() : "",
  };
  $("#assistant-save").disabled = true;
  status.textContent = "Zapisuję w chmurze…";
  try {
    await cloud.saveAssistantConfig(cfg);
    status.textContent = resolveAssistantConfig(cfg) ? "✓ Zapisano — asystent gotowy." : "Zapisano, ale konfiguracja jest niepełna (brak klucza?).";
    toast("Zapisano konfigurację asystenta");
  } catch (err) {
    status.textContent = err.message || "Nie udało się zapisać.";
  } finally {
    $("#assistant-save").disabled = false;
  }
});
window.addEventListener("pa:settings", refreshAssistantConfigCard);

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
      navigator.serviceWorker?.ready.then(reg => reg.showNotification("PlantApp", {
        body: due.length === 1 ? `${due[0].name} czeka na podlanie!` : `${due.length} rośliny czekają na podlanie: ${due.map(p => p.name).join(", ")}`,
        icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "watering"
      }));
      localStorage.setItem("pa_notified", today);
    } catch { /* brak wsparcia */ }
  }
}


// ============ MODALE: zdjęcia i notatki ============
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-photo]")) closePhotoViewer();
  if (e.target.closest("[data-close-note]")) closeNoteModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!$("#photo-viewer")?.classList.contains("hidden")) closePhotoViewer();
  else if (!$("#note-modal")?.classList.contains("hidden")) closeNoteModal();
});
window.addEventListener("popstate", () => {
  if (suppressPhotoPop) { suppressPhotoPop = false; return; }
  if (photoViewerOpen) closePhotoViewer(true);
});
$("#note-form")?.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!noteContext) return;
  const title = $("#note-title").value.trim();
  const text = $("#note-text").value.trim();
  if (!text) { toast("Wpisz treść notatki"); return; }
  if (noteContext.entryId) {
    mutatePlant(noteContext.plantId, p => {
      const entry = (p.journal || []).find(e => e.id === noteContext.entryId);
      if (entry) {
        entry.title = title;
        entry.text = text;
        entry.updatedAt = Date.now();
      }
    });
    toast("Zaktualizowano notatkę");
  } else {
    addJournal(noteContext.plantId, { type: "note", title, text });
    toast("Dodano notatkę");
  }
  const plantId = noteContext.plantId;
  closeNoteModal();
  openDetail(plantId);
});

// ============ START ============
function init() {
  const intro = $("#leaf-intro");
  if (intro) {
    if (sessionStorage.getItem("pa_intro")) intro.classList.add("skip");
    else { sessionStorage.setItem("pa_intro", "1"); setTimeout(() => intro.remove(), 2400); }
  }
  document.body.classList.toggle("on-plants", currentView === "plants");
  refreshApiKeyField();
  refreshAssistantConfigCard();
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
