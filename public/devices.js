const $ = (selector) => document.querySelector(selector);
let setup = { tapo: {}, devices: [] };
let toastTimer;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = "toast"; }, 2600);
}

function statusLabel(device, status) {
  if (status?.available) return status.active ? "WŁĄCZONE" : "WYŁĄCZONE";
  if (!device.configured) return "WYMAGA DANYCH";
  return status?.error ? "BRAK POŁĄCZENIA" : "GOTOWE DO TESTU";
}

function statusDetail(device, status) {
  if (status?.error) return status.error;
  if (!device.configured) return device.provider === "tapo" ? "Uzupełnij konto Tapo powyżej" : "Uzupełnij lokalny klucz Tuya";
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
        <div class="device-type"><div class="device-icon">${device.provider === "tapo" ? "P" : "T"}</div><div><strong>${escapeHtml(device.name)}</strong><span>${escapeHtml(device.provider.toUpperCase())} · ${escapeHtml(device.model ?? "WiFi Switch")}</span></div></div>
        <div class="state-dot" title="${escapeHtml(statusDetail(device, state))}"><i></i><span class="device-state">${statusLabel(device, state)}</span></div>
      </div>
      <div class="device-fields">
        <label>Nazwa kafelka<input data-field="name" value="${escapeHtml(device.name)}"></label>
        ${device.provider === "tuya" ? '<label>Local key Tuya<input data-field="localKey" type="password" placeholder="Pozostaw puste, aby nie zmieniać"></label>' : '<label>Konfiguracja<input value="Wspólne konto Tapo powyżej" disabled></label>'}
      </div>
      <p class="device-error">${escapeHtml(statusDetail(device, state))}</p>
      <div class="device-meta"><span>${escapeHtml(device.ip)}</span><span>${escapeHtml(device.alias)}</span></div>`;
    return card;
  }));
}

async function load() {
  const response = await fetch("/api/local-devices");
  if (!response.ok) throw new Error("Nie udało się odczytać urządzeń");
  setup = await response.json();
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
        localKey: card.querySelector('[data-field="localKey"]')?.value ?? ""
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
$("#test-devices").addEventListener("click", testDevices);
load().catch((error) => notify(error.message, true));
