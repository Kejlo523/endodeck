const $ = (selector) => document.querySelector(selector);
let setup = { tapo: {}, devices: [] };
let toastTimer;

function applyTheme(config) {
  const accent = config?.accent;
  if (typeof accent === "string" && /^#[0-9a-fA-F]{6}$/.test(accent)) {
    document.documentElement.style.setProperty("--accent", accent);
  }
}

function watchTheme() {
  const events = new EventSource("/api/events");
  events.addEventListener("config", (event) => applyTheme(JSON.parse(event.data)));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `studio-toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "studio-toast"; }, 2600);
}

function statusLabel(device, status) {
  if (status?.available) return status.active ? "WŁĄCZONE" : "WYŁĄCZONE";
  if (!device.configured) return "WYMAGA DANYCH";
  return status?.error ? "BRAK POŁĄCZENIA" : "GOTOWE DO TESTU";
}

function statusDetail(device, status) {
  if (status?.error) return status.error;
  if (!device.configured) return "Uzupełnij konto Tapo powyżej";
  return "Kliknij sprawdzenie połączenia";
}

function renderDevices(states = {}) {
  $("#device-count").textContent = `${setup.devices.length} urządzeń · sieć lokalna`;
  $("#device-grid").replaceChildren(...setup.devices.map((device) => {
    const state = states[device.alias];
    const card = document.createElement("article");
    card.className = `device-card${state?.available ? " online" : device.configured ? "" : " locked"}`;
    card.dataset.alias = device.alias;
    card.innerHTML = `
      <div class="device-head">
        <div class="device-type"><div class="device-icon">P</div><div><strong>${escapeHtml(device.name)}</strong><span>TAPO · ${escapeHtml(device.model ?? "WiFi Switch")}</span></div></div>
        <div class="state-dot" title="${escapeHtml(statusDetail(device, state))}"><i></i><span class="device-state">${statusLabel(device, state)}</span></div>
      </div>
      <div class="device-fields">
        <label>Nazwa kafelka<input data-field="name" value="${escapeHtml(device.name)}"></label>
        <label>Adres IPv4<input data-field="ip" value="${escapeHtml(device.ip)}" inputmode="decimal" placeholder="192.168.1.20"></label>
      </div>
      <p class="device-error">${escapeHtml(statusDetail(device, state))}</p>
      <div class="device-meta"><span>${escapeHtml(device.alias)}</span><button type="button" data-remove="${escapeHtml(device.alias)}">USUŃ</button></div>`;
    card.querySelector("[data-remove]").addEventListener("click", () => { setup.devices = setup.devices.filter((entry) => entry.alias !== device.alias); renderDevices(states); });
    return card;
  }));
}

async function load() {
  const [configResponse, devicesResponse] = await Promise.all([
    fetch("/api/config"),
    fetch("/api/local-devices")
  ]);
  if (!devicesResponse.ok) throw new Error("Nie udało się odczytać urządzeń");
  setup = await devicesResponse.json();
  if (configResponse.ok) applyTheme(await configResponse.json());
  $("#tapo-user").value = setup.tapo.username ?? "";
  $("#password-state").textContent = setup.tapo.hasPassword ? "Hasło jest zapisane lokalnie" : "Brak zapisanego hasła";
  renderDevices();
}

async function save() {
  const button = $("#save-devices");
  button.disabled = true;
  try {
    const devices = {};
    for (const card of document.querySelectorAll(".device-card")) {
      devices[card.dataset.alias] = {
        name: card.querySelector('[data-field="name"]').value,
        ip: card.querySelector('[data-field="ip"]').value,
        provider: "tapo",
        model: "P100"
      };
    }
    const response = await fetch("/api/local-devices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tapo: { username: $("#tapo-user").value, password: $("#tapo-password").value }, devices })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Nie udało się zapisać");
    setup = await response.json();
    $("#tapo-password").value = "";
    $("#password-state").textContent = setup.tapo.hasPassword ? "Hasło jest zapisane lokalnie" : "Brak zapisanego hasła";
    renderDevices();
    notify("Ustawienia zapisane lokalnie");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function savePasswordOnly() {
  const button = $("#save-password");
  button.disabled = true;
  try {
    const username = $("#tapo-user").value.trim();
    const password = $("#tapo-password").value;
    if (!username) throw new Error("Podaj e-mail konta Tapo");
    if (!password && !setup.tapo.hasPassword) throw new Error("Podaj hasło do zapisania");
    const devices = Object.fromEntries(setup.devices.map((device) => [device.alias, {
      name: device.name,
      ip: device.ip,
      provider: device.provider ?? "tapo",
      model: device.model ?? "P100"
    }]));
    const response = await fetch("/api/local-devices", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tapo: { username, password }, devices })
    });
    if (!response.ok) throw new Error((await response.json()).error || "Nie udało się zapisać hasła");
    setup = await response.json();
    $("#tapo-password").value = "";
    $("#password-state").textContent = setup.tapo.hasPassword ? "Hasło jest zapisane lokalnie" : "Brak zapisanego hasła";
    renderDevices();
    notify("Hasło zapisane i gotowe do testowania połączenia");
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function testDevices() {
  const button = $("#test-devices");
  button.disabled = true;
  button.textContent = "SPRAWDZAM...";
  try {
    const response = await fetch("/api/local-devices/test", { method: "POST" });
    const states = await response.json();
    if (!response.ok) throw new Error(states.error || "Test nie powiódł się");
    renderDevices(states);
    const online = Object.values(states).filter((state) => state.available).length;
    notify(`Dostępne lokalnie: ${online}/${setup.devices.length}`);
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; button.textContent = "SPRAWDŹ POŁĄCZENIE"; }
}

$("#save-devices").addEventListener("click", save);
$("#save-password").addEventListener("click", savePasswordOnly);
$("#test-devices").addEventListener("click", testDevices);
$("#add-device").addEventListener("click", () => {
  const index = setup.devices.length + 1;
  setup.devices.push({ alias: `tapo-${Date.now().toString(36)}`, name: `Tapo ${index}`, ip: "", provider: "tapo", model: "P100", configured: Boolean(setup.tapo.hasPassword && setup.tapo.username) });
  renderDevices();
});

const passwordInput = $("#tapo-password");
const passwordToggle = $("#password-toggle");
passwordToggle.addEventListener("click", () => {
  const visible = passwordInput.type === "password";
  passwordInput.type = visible ? "text" : "password";
  passwordToggle.classList.toggle("is-visible", visible);
  passwordToggle.setAttribute("aria-pressed", String(visible));
  passwordToggle.setAttribute("aria-label", visible ? "Ukryj hasło" : "Pokaż hasło");
});

load().catch((error) => notify(error.message, true));
watchTheme();
