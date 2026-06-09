/* PlantApp v1.0 — logika aplikacji. Wszystkie dane lokalnie (localStorage). */
"use strict";

// ============ STAN ============
const store = {
  get plants() { return JSON.parse(localStorage.getItem("pa_plants") || "[]"); },
  set plants(v) { localStorage.setItem("pa_plants", JSON.stringify(v)); },
  get apiKey() { return localStorage.getItem("pa_apikey") || ""; },
  set apiKey(v) { localStorage.setItem("pa_apikey", v); },
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10);
const DAY = 86400000;

function isSummer() { const m = new Date().getMonth() + 1; return m >= 4 && m <= 9; } // IV–IX sezon wzrostu
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

// ============ BAZA PIELĘGNACJI ============
function careFor(latinName) {
  if (!latinName) return CARE_DEFAULT;
  const lower = latinName.toLowerCase();
  for (const key of Object.keys(CARE_DB)) {
    if (lower.includes(key)) return CARE_DB[key];
  }
  return CARE_DEFAULT;
}
function currentInterval(plant) {
  if (plant.customInterval) return plant.customInterval;
  const c = careFor(plant.latin);
  return isSummer() ? c.waterSummer : c.waterWinter;
}
function daysUntilWater(plant) {
  const last = plant.lastWatered || plant.added;
  const due = last + currentInterval(plant) * DAY;
  return Math.ceil((due - Date.now()) / DAY);
}

// ============ NAWIGACJA ============
function goto(view) {
  $$(".view").forEach(v => v.classList.remove("active"));
  $("#view-" + view).classList.add("active");
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.goto === view));
  window.scrollTo(0, 0);
  if (view === "plants") renderPlants();
  if (view === "scan" || view === "doctor") updateKeyWarnings();
}
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-goto]");
  if (g) { e.preventDefault(); goto(g.dataset.goto); }
});

// ============ PIERŚCIEŃ PODLEWANIA (sygnatura) ============
function ringSVG(plant, size = 54) {
  const interval = currentInterval(plant);
  const daysLeft = daysUntilWater(plant);
  const frac = Math.max(0, Math.min(1, daysLeft / interval));
  const r = (size / 2) - 4, c = 2 * Math.PI * r;
  const overdue = daysLeft <= 0;
  const label = overdue ? "💧" : daysLeft;
  const sub = overdue ? "" : (daysLeft === 1 ? "dzień" : "dni");
  return `<div class="ring" style="width:${size}px;height:${size}px" role="img" aria-label="Podlewanie za ${daysLeft} dni">
    <svg width="${size}" height="${size}">
      <circle class="ring-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="5"/>
      <circle class="ring-fill ${overdue ? "overdue" : ""}" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="5"
        stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}"/>
    </svg>
    <div class="ring-label">${label}<small>${sub}</small></div>
  </div>`;
}

// ============ LISTA ROŚLIN ============
function renderPlants() {
  const plants = store.plants;
  const list = $("#plants-list"), empty = $("#plants-empty"), banner = $("#due-banner");
  list.innerHTML = "";
  empty.classList.toggle("hidden", plants.length > 0);

  const due = plants.filter(p => daysUntilWater(p) <= 0);
  if (due.length) {
    banner.classList.remove("hidden");
    banner.innerHTML = `💧 <strong>${due.length === 1 ? "1 roślina czeka" : due.length + " rośliny czekają"} na podlanie:</strong> ${due.map(p => p.name).join(", ")}`;
  } else banner.classList.add("hidden");

  plants
    .slice()
    .sort((a, b) => daysUntilWater(a) - daysUntilWater(b))
    .forEach(p => {
      const d = daysUntilWater(p);
      const el = document.createElement("div");
      el.className = "plant-card";
      el.innerHTML = `
        ${p.photo ? `<img class="plant-photo" src="${p.photo}" alt="">` : `<div class="plant-photo">🪴</div>`}
        <div class="plant-info">
          <div class="plant-name">${esc(p.name)}</div>
          <div class="plant-species">${esc(p.latin || "gatunek nieznany")}</div>
          <div class="plant-due ${d <= 0 ? "overdue" : ""}">${d <= 0 ? "Podlej dzisiaj!" : "Podlewanie za " + d + " " + (d === 1 ? "dzień" : "dni")}</div>
        </div>
        ${ringSVG(p)}`;
      el.addEventListener("click", () => openDetail(p.id));
      list.appendChild(el);
    });

  $("#season-badge").textContent = isSummer() ? "☀️ sezon wzrostu" : "❄️ spoczynek zimowy";
}

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, m => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])); }

// ============ SZCZEGÓŁY ROŚLINY ============
let detailId = null;
function openDetail(id) {
  detailId = id;
  const p = store.plants.find(x => x.id === id);
  if (!p) return;
  const care = careFor(p.latin);
  const d = daysUntilWater(p);
  const interval = currentInterval(p);
  const hist = (p.history || []).slice(-5).reverse();

  $("#plant-detail-content").innerHTML = `
    <div class="detail-hero">
      ${p.photo ? `<img class="detail-photo" src="${p.photo}" alt="">` : `<div class="detail-photo">🪴</div>`}
      <div>
        <div class="detail-name">${esc(p.name)}</div>
        <div class="detail-latin">${esc(p.latin || "")}</div>
        ${care.toxic === true ? `<div style="color:var(--alert);font-size:.8rem;margin-top:4px">⚠️ Toksyczna dla zwierząt</div>` : care.toxic === false ? `<div style="color:var(--leaf);font-size:.8rem;margin-top:4px">✓ Bezpieczna dla zwierząt</div>` : ""}
      </div>
    </div>

    <div class="water-block">
      ${ringSVG(p, 76)}
      <div style="flex:1">
        <div style="font-weight:800">${d <= 0 ? "Czas podlać!" : "Podlewanie za " + d + " " + (d === 1 ? "dzień" : "dni")}</div>
        <div class="muted" style="margin:4px 0 10px">co ${interval} dni (${isSummer() ? "sezon letni" : "sezon zimowy"})</div>
        <button class="btn btn-water" id="water-now">💧 Podlałem/am teraz</button>
      </div>
    </div>

    <div class="card">
      <div class="k muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Częstotliwość podlewania</div>
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
    <div class="card"><div class="k muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">💡 Wskazówki</div><div style="font-size:.9rem;line-height:1.55">${esc(care.tips)}</div></div>

    ${hist.length ? `<div class="card"><div class="k muted" style="font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Ostatnie podlewania</div><ul class="history">${hist.map(h => `<li>${new Date(h).toLocaleDateString("pl-PL", { day: "numeric", month: "long" })}</li>`).join("")}</ul></div>` : ""}

    <button class="btn btn-danger btn-block" id="delete-plant">Usuń roślinę</button>
  `;

  $("#water-now").onclick = () => {
    mutatePlant(id, p => { p.lastWatered = Date.now(); p.history = [...(p.history || []), Date.now()].slice(-30); });
    toast("💧 Zapisano podlewanie");
    openDetail(id);
  };
  $("#int-minus").onclick = () => { mutatePlant(id, p => p.customInterval = Math.max(1, currentInterval(p) - 1)); openDetail(id); };
  $("#int-plus").onclick = () => { mutatePlant(id, p => p.customInterval = currentInterval(p) + 1); openDetail(id); };
  const reset = $("#int-reset"); if (reset) reset.onclick = () => { mutatePlant(id, p => delete p.customInterval); openDetail(id); };
  $("#delete-plant").onclick = () => {
    if (confirm(`Usunąć „${p.name}" z kolekcji?`)) {
      store.plants = store.plants.filter(x => x.id !== id);
      toast("Usunięto"); goto("plants");
    }
  };
  goto("plant-detail");
  $$(".tab").forEach(t => t.classList.toggle("active", t.dataset.goto === "plants"));
}
function mutatePlant(id, fn) {
  const plants = store.plants;
  const p = plants.find(x => x.id === id);
  if (p) { fn(p); store.plants = plants; }
}

// ============ ZDJĘCIA: kompresja do ~1280px JPEG ============
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

// ============ SKANOWANIE — Pl@ntNet identify ============
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
    if (res.status === 401 || res.status === 403) throw new Error("Klucz API odrzucony — sprawdź go w Ustawieniach.");
    if (res.status === 404) throw new Error("Nie rozpoznano rośliny na zdjęciu. Spróbuj wyraźniejszego zdjęcia liścia lub kwiatu.");
    if (res.status === 429) throw new Error("Wyczerpany dzienny limit darmowych rozpoznań (500/dzień). Spróbuj jutro.");
    if (!res.ok) throw new Error("Błąd serwera Pl@ntNet (" + res.status + "). Spróbuj ponownie.");
    const data = await res.json();
    renderScanResults(data.results || []);
    st.classList.add("hidden");
  } catch (err) {
    st.classList.add("error");
    st.textContent = navigator.onLine ? (err.message || "Coś poszło nie tak.") : "Brak internetu — identyfikacja wymaga połączenia.";
  } finally {
    $("#scan-go").disabled = false;
  }
});

function renderScanResults(results) {
  const box = $("#scan-results");
  if (!results.length) { box.innerHTML = `<div class="status error">Brak dopasowań. Spróbuj zdjęcia z bliska, na jednolitym tle.</div>`; return; }
  box.innerHTML = "";
  results.slice(0, 4).forEach((r, i) => {
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
        ${known ? `💧 Podlewanie co ~${isSummer() ? care.waterSummer : care.waterWinter} dni · ${care.toxic ? "⚠️ toksyczna" : care.toxic === false ? "✓ bezpieczna dla zwierząt" : ""}` : "Brak w bazie pielęgnacji — dodam z ogólnym planem podlewania, dostroisz ręcznie."}
      </div>
      <div class="result-actions">
        <button class="btn btn-primary" data-add="${i}">＋ Dodaj do kolekcji</button>
      </div>`;
    card.querySelector("[data-add]").onclick = () => addPlant(latin, care.pl || common || latin);
    box.appendChild(card);
  });
}

function addPlant(latin, displayName) {
  const name = prompt("Nazwa rośliny (np. „Monstera w salonie”):", displayName) || displayName;
  const plants = store.plants;
  plants.push({ id: uid(), name, latin, photo: scanThumb, added: Date.now(), lastWatered: Date.now(), history: [] });
  store.plants = plants;
  toast("🪴 Dodano: " + name);
  scanBlob = null; scanThumb = null;
  $("#scan-preview").innerHTML = `<span class="photo-cta">📷<br>Dotknij, by zrobić zdjęcie</span>`;
  $("#scan-results").innerHTML = ""; $("#scan-go").disabled = true;
  goto("plants");
}

// ============ DOKTOR — Pl@ntNet diseases + objawy ============
let doctorBlob = null;

$$(".seg-btn").forEach(b => b.addEventListener("click", () => {
  $$(".seg-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  $("#doctor-photo").classList.toggle("hidden", b.dataset.mode !== "photo");
  $("#doctor-symptoms").classList.toggle("hidden", b.dataset.mode !== "symptoms");
}));

$("#doctor-file").addEventListener("change", async (e) => {
  const f = e.target.files[0]; if (!f) return;
  doctorBlob = await fileToCompressed(f);
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
    fd.append("image", doctorBlob, "photo.jpg");
    const url = `https://my-api.plantnet.org/v2/diseases/identify?api-key=${encodeURIComponent(store.apiKey)}&lang=pl`;
    const res = await fetch(url, { method: "POST", body: fd });
    if (res.status === 401 || res.status === 403) throw new Error("Klucz API odrzucony — sprawdź go w Ustawieniach.");
    if (res.status === 404) throw new Error("AI nie rozpoznało choroby na tym zdjęciu. Spróbuj zbliżenia samej zmiany — albo użyj trybu „Po objawach”.");
    if (res.status === 429) throw new Error("Wyczerpany dzienny limit zapytań. Spróbuj jutro lub użyj trybu „Po objawach”.");
    if (!res.ok) throw new Error("Błąd serwera Pl@ntNet (" + res.status + ").");
    const data = await res.json();
    renderDoctorResults(data.results || []);
    st.classList.add("hidden");
  } catch (err) {
    st.classList.add("error");
    st.textContent = navigator.onLine ? (err.message || "Coś poszło nie tak.") : "Brak internetu — użyj trybu „Po objawach” (działa offline).";
  } finally {
    $("#doctor-go").disabled = false;
  }
});

function renderDoctorResults(results) {
  const box = $("#doctor-results");
  if (!results.length) { box.innerHTML = `<div class="status error">Brak rozpoznania. Spróbuj zbliżenia zmiany lub trybu „Po objawach”.</div>`; return; }
  box.innerHTML = "";
  results.slice(0, 3).forEach(r => {
    const code = (r.name || "").toUpperCase();
    const known = DISEASE_DB[code];
    const score = Math.round((r.score || 0) * 100);
    const displayName = known ? known.pl : (r.commonNames?.[0] || r.name || "Nieznana zmiana");
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="result-head">
        <div class="result-name">${esc(displayName)}</div>
        <span class="score-pill ${score >= 50 ? "score-high" : "score-mid"}">${score}%</span>
      </div>
      <div class="result-body">
        ${known ? `<strong>Jak rozpoznać:</strong> ${esc(known.what)}<br><br><strong>Co robić:</strong> ${esc(known.action)}` : `Kod EPPO: ${esc(code)}. Brak szczegółów w lokalnej bazie — wyszukaj kod, by dowiedzieć się więcej.`}
      </div>`;
    box.appendChild(card);
  });
  box.insertAdjacentHTML("beforeend", `<p class="muted small">Diagnoza AI jest orientacyjna — przy poważnym porażeniu porównaj z trybem „Po objawach” i obserwuj roślinę przez kilka dni.</p>`);
}

// objawowy — offline
function renderSymptoms() {
  $("#symptoms-list").innerHTML = SYMPTOMS_DB.map(s => `
    <details class="symptom">
      <summary>${esc(s.label)}</summary>
      <div class="symptom-body"><strong>Prawdopodobna przyczyna:</strong> ${esc(s.causes)}<br><br><strong>Co robić:</strong> ${esc(s.action)}</div>
    </details>`).join("");
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
  const blob = new Blob([JSON.stringify({ plants: store.plants, exported: new Date().toISOString() }, null, 2)], { type: "application/json" });
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
    store.plants = data.plants;
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
    } catch { /* powiadomienie nieobsługiwane */ }
  }
}

// ============ START ============
function init() {
  $("#api-key").value = store.apiKey;
  renderSymptoms();
  renderPlants();
  updateKeyWarnings();
  checkDueAndNotify();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
