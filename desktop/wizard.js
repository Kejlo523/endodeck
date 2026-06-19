const api = window.EndoDeckDesktop;
const $ = (selector) => document.querySelector(selector);
let diagnosis;
let toastTimer;
let rebootReady = false;

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => { toast.className = ""; }, 4200);
}

function setStep(selector, state, detail) {
  const step = $(selector);
  if (!step) return;
  step.classList.remove("ok", "warn", "fail");
  if (state) step.classList.add(state);
  if (detail) step.querySelector("span").textContent = detail;
}

function setChecking(checking) {
  document.body.classList.toggle("checking", checking);
  $("#scan").disabled = checking;
  $("#scan").textContent = checking ? "SPRAWDZAM..." : "SKANUJ USB";
}

function setStudioReady(ready, label = "PRZEJDŹ DO STUDIO") {
  const button = $("#studio");
  button.disabled = !ready;
  button.textContent = ready ? label : "NAJPIERW PODŁĄCZ TELEFON";
  button.classList.toggle("ready", ready);
  document.body.classList.toggle("ready", ready);
}

function renderCompatibility(device) {
  $("#compatibility").innerHTML = [
    `Android API ${device.sdk || "--"} ${device.sdk >= 24 && device.sdk <= 30 ? "OK" : "WYMAGA 24-30"}`,
    `Root ${device.root ? "OK" : "BRAK"} · Magisk ${device.magisk || "--"} ${device.magiskCompatible ? "OK" : "SPRAWDŹ"}`,
    `WebView ${device.webView || "niewykryty"} ${device.webViewCompatible ? "OK" : "119+ zalecane"}`
  ].map((item) => `<li>${item}</li>`).join("");
}

function render(device) {
  diagnosis = device;
  setChecking(false);
  document.body.classList.toggle("online", Boolean(device.connected));

  const deviceName = device.connected ? `${device.manufacturer} ${device.model}` : "Brak telefonu";
  $("#connected-device").textContent = device.connected ? `${deviceName} · ${device.serial}` : "Brak telefonu";
  $("#android-state").textContent = device.sdk ? `Android ${device.android} · API ${device.sdk}` : "---";
  $("#root-state").textContent = device.root ? `Root OK · Magisk ${device.magisk || "--"}` : "Root niedostępny";
  $("#webview-state").textContent = device.webView || "Niewykryty";
  $("#device-state").textContent = device.connected ? `${deviceName} · ${device.serial}` : device.errors?.[0] || "Telefon offline";

  const installed = Boolean(device.installedApk);
  const apkReady = Boolean(device.connected && device.apkInstallable);
  const studioReady = Boolean(device.connected && (installed || device.supported || device.apkInstallable));
  const profileLabel = device.profile ? `${device.profile.name} · APK ${device.profile.apkVariant}` : "Brak zgodnego profilu";
  const apkLabel = installed ? `Zainstalowana wersja ${device.installedApk}` : apkReady ? `Gotowe do instalacji · ${device.profile?.apkVariant || "auto"}` : "Czeka na zgodny telefon";

  $("#status-title").textContent = studioReady ? "Urządzenie gotowe" : device.connected ? "Wymaga konfiguracji" : "Czekam na telefon";
  $("#welcome-title").textContent = studioReady ? "Możesz przejść do Studio." : device.connected ? "Telefon wykryty, sprawdzam profil." : "Podłącz telefon przez USB.";
  $("#welcome-copy").textContent = studioReady
    ? "Połączenie lokalne działa. Studio pozwoli edytować kafelki, strony, aplikacje Windows i ustawienia wygaszacza."
    : device.connected
      ? "EndoDeck wykrył urządzenie. Dokończ instalację APK lub modułów Magisk z dolnego paska, jeśli są wymagane."
      : "Po podłączeniu telefonu EndoDeck sprawdzi ADB, Androida, WebView, root i dobierze profil sprzętowy.";

  setStep("#step-usb", device.connected ? "ok" : "warn", $("#device-state").textContent);
  setStep("#step-apk", installed ? "ok" : apkReady ? "warn" : "fail", apkLabel);
  setStep("#step-profile", device.supported ? "ok" : device.profile ? "warn" : "fail", profileLabel);
  $("#profile-state").textContent = profileLabel;
  $("#apk-state").textContent = apkLabel;
  renderCompatibility(device);

  $("#phone-app").classList.toggle("hidden", !device.connected || !device.apkInstallable);
  $("#install-apk").disabled = !apkReady;
  $("#install-apk").textContent = installed ? "ODŚWIEŻ APK" : "INSTALUJ APK";
  $("#install").disabled = !device.supported;
  $("#install").textContent = rebootReady ? "URUCHOM TELEFON" : "INSTALUJ MAGISK";

  const blockers = device.errors || [];
  $("#profile-blocker").textContent = blockers.length ? `Pełny profil Magisk jest jeszcze zablokowany: ${blockers.join(" · ")}` : "";
  $("#profile-blocker").classList.toggle("hidden", !device.connected || device.supported || !blockers.length);
  $("#options").classList.toggle("hidden", !device.connected);
  $("#dt2w").disabled = !device.profile?.features.doubleTapWake;
  $("#battery").disabled = !device.profile?.features.batteryGuard;
  $("#dt2w").checked = Boolean(device.profile?.features.doubleTapWake);
  $("#battery").checked = Boolean(device.profile?.features.batteryGuard);
  setStudioReady(studioReady);
}

function renderRuntimeState(state) {
  document.body.classList.toggle("online", Boolean(state.adb));
  setChecking(false);
  if (state.adb || diagnosis) return;
  const detected = state.detectedSerials || [];
  const message = detected.length
    ? `Wykryto inny telefon ADB: ${detected.join(", ")}. Kliknij SKANUJ USB, jeśli chcesz go skonfigurować.`
    : "Podłącz telefon z włączonym debugowaniem USB.";
  $("#device-state").textContent = message;
  $("#connected-device").textContent = detected.length ? detected.join(", ") : "Brak telefonu";
  $("#status-title").textContent = detected.length ? "Telefon wykryty" : "Czekam na telefon";
  $("#welcome-title").textContent = detected.length ? "Wykryto urządzenie ADB." : "Podłącz telefon przez USB.";
  $("#welcome-copy").textContent = detected.length
    ? "Uruchom skan, żeby EndoDeck sprawdził Androida, WebView, root i profil sprzętowy."
    : "EndoDeck działa już w tle. Po podłączeniu telefonu status zmieni się automatycznie.";
  setStep("#step-usb", detected.length ? "warn" : "", message);
  setStep("#step-apk", "", "Czeka na diagnozę.");
  setStep("#step-profile", "", "Zostanie dobrany automatycznie.");
  $("#install-apk").disabled = true;
  $("#install").disabled = true;
  setStudioReady(false);
}

async function scanDevice(serial = null) {
  setChecking(true);
  try {
    render(await api.diagnose(serial));
  } catch (error) {
    setChecking(false);
    notify(error.message, true);
  }
}

$("#scan").addEventListener("click", () => scanDevice(diagnosis?.serial ?? null));

$("#install-apk").addEventListener("click", async () => {
  if (!diagnosis?.serial) return;
  const button = $("#install-apk");
  button.disabled = true;
  button.textContent = "INSTALUJĘ...";
  try {
    render(await api.installApk(diagnosis.serial));
    notify("APK EndoDeck została zainstalowana i uruchomiona na telefonie.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    if (diagnosis) button.textContent = diagnosis.installedApk ? "ODŚWIEŻ APK" : "INSTALUJ APK";
    button.disabled = !diagnosis?.apkInstallable;
  }
});

$("#install").addEventListener("click", async () => {
  if (!diagnosis?.serial) return;
  if (rebootReady) {
    rebootReady = false;
    $("#install").disabled = true;
    $("#install").textContent = "URUCHAMIAM...";
    try { await api.reboot(diagnosis.serial); notify("Telefon uruchamia się ponownie."); }
    catch (error) { notify(error.message, true); $("#install").disabled = false; $("#install").textContent = "URUCHOM TELEFON"; rebootReady = true; }
    return;
  }
  $("#install").disabled = true;
  $("#install").textContent = "INSTALUJĘ...";
  try {
    const result = await api.install({ serial: diagnosis.serial, options: {
      lockscreenBypass: $("#lockscreen").checked,
      doubleTapWake: $("#dt2w").checked,
      batteryGuard: $("#battery").checked,
      "endodeck-balanced": $("#balanced").checked,
      "endodeck-oem-huawei-ale-l21": $("#dt2w").checked || $("#battery").checked
    } });
    notify(`Zainstalowano profil ${result.profile.name}. Wymagany restart telefonu.`);
    $("#install").textContent = "URUCHOM TELEFON";
    $("#install").disabled = false;
    rebootReady = true;
  } catch (error) {
    notify(error.message, true);
    $("#install").disabled = false;
    $("#install").textContent = "INSTALUJ MAGISK";
  }
});

$("#studio").addEventListener("click", () => api.openStudio());
$("#data").addEventListener("click", () => api.openData());
$("#restart-server").addEventListener("click", async () => {
  const button = $("#restart-server");
  button.disabled = true;
  button.textContent = "Restartuję...";
  try {
    const result = await api.restartServer();
    if (!result.ok) throw new Error(result.error || "Nie udało się zrestartować serwera");
    diagnosis = null;
    renderRuntimeState(result.state || {});
    notify(`Serwer działa ponownie na porcie ${result.port}.`);
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Restart serwera";
  }
});

$("#updates").addEventListener("click", async () => {
  const result = await api.checkUpdates();
  if (!result.ok) return notify(result.error, true);
  if (result.phone?.modulesPending && diagnosis?.serial && window.confirm(`Pobrano ${result.phone.modulesPending} aktualizacje modułów Magisk. Zainstalować je teraz? Po instalacji będzie wymagany restart telefonu.`)) {
    const installed = await api.installModuleUpdates(diagnosis.serial);
    return notify(`Zainstalowano ${installed.installed} moduły. Uruchom telefon ponownie.`);
  }
  notify(result.phone?.apkUpdated ? "APK telefonu zostało zaktualizowane i sprawdzone." : result.phone?.available ? `Dostępne wydanie ${result.phone.version}.` : "Brak nowszej aktualizacji.");
});

$("#autostart").addEventListener("change", (event) => api.setAutostart(event.target.checked));
api.getAutostart().then((state) => { $("#autostart").checked = state.openAtLogin; });
api.status().then(async ({ state }) => {
  renderRuntimeState(state);
  const serial = state.serial || state.detectedSerials?.[0] || null;
  if (serial) await scanDevice(serial);
}).catch((error) => {
  setChecking(false);
  notify(error.message, true);
});
api.onUpdateStatus((state) => notify(state.error || state.message || "Stan aktualizacji zmieniony", Boolean(state.error)));
