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

function render(device) {
  diagnosis = device;
  document.body.classList.toggle("online", Boolean(device.connected));
  $("#device-state").textContent = device.connected ? `${device.manufacturer} ${device.model} · Android ${device.android} · ${device.serial}` : device.errors?.[0] || "Telefon offline";
  $("#compatibility").innerHTML = [
    `Android API ${device.sdk || "--"} ${device.sdk >= 24 && device.sdk <= 30 ? "✓" : "✕"}`,
    `Root ${device.root ? "✓" : "✕"} · Magisk ${device.magisk || "--"} ${device.magiskCompatible ? "✓" : "✕"}`,
    `WebView ${device.webView || "niewykryty"} ${device.webViewCompatible ? "✓" : "✕"}`
  ].map((item) => `<li>${item}</li>`).join("");
  $("#profile-state").textContent = device.profile ? `${device.profile.name} · APK ${device.profile.apkVariant}` : "Brak zgodnego profilu";
  $("#phone-app").classList.toggle("hidden", !device.connected || !device.apkInstallable);
  const installed = Boolean(device.installedApk);
  const webViewWarning = device.webViewCompatible ? "" : ` WebView ${device.webView || "niewykryty"} jest starszy niż zalecany 119+; APK można zainstalować, ale interfejs może wymagać aktualizacji WebView.`;
  $("#apk-state").textContent = installed
    ? `Zainstalowana wersja ${device.installedApk}.${webViewWarning}`
    : `Aplikacja nie jest zainstalowana. Zostanie użyty wariant ${device.profile?.apkVariant || "automatyczny"}.${webViewWarning}`;
  $("#install-apk").textContent = installed ? "ZAINSTALUJ PONOWNIE APK" : "ZAINSTALUJ APK";
  const blockers = device.errors || [];
  $("#profile-blocker").textContent = blockers.length ? `Pełny profil Magisk jest jeszcze zablokowany: ${blockers.join(" · ")}` : "";
  $("#profile-blocker").classList.toggle("hidden", !device.connected || device.supported || !blockers.length);
  $("#options").classList.toggle("hidden", !device.supported);
  $("#dt2w").disabled = !device.profile?.features.doubleTapWake;
  $("#battery").disabled = !device.profile?.features.batteryGuard;
  $("#dt2w").checked = Boolean(device.profile?.features.doubleTapWake);
  $("#battery").checked = Boolean(device.profile?.features.batteryGuard);
}

function renderRuntimeState(state) {
  document.body.classList.toggle("online", Boolean(state.adb));
  if (state.adb || diagnosis) return;
  const detected = state.detectedSerials || [];
  $("#device-state").textContent = detected.length
    ? `Wykryto inny telefon ADB: ${detected.join(", ")}. Kliknij SKANUJ USB, jeśli chcesz go skonfigurować.`
    : "Podłącz telefon z włączonym debugowaniem USB.";
}

$("#scan").addEventListener("click", async () => {
  $("#scan").disabled = true;
  $("#scan").textContent = "SPRAWDZAM...";
  try { render(await api.diagnose()); }
  catch (error) { notify(error.message, true); }
  finally { $("#scan").disabled = false; $("#scan").textContent = "SKANUJ USB"; }
});

$("#install-apk").addEventListener("click", async () => {
  if (!diagnosis?.serial) return;
  const button = $("#install-apk");
  button.disabled = true;
  button.textContent = "INSTALUJĘ APK...";
  try {
    render(await api.installApk(diagnosis.serial));
    notify("APK EndoDeck została zainstalowana i uruchomiona na telefonie.");
  } catch (error) {
    notify(error.message, true);
  } finally {
    button.disabled = false;
    if (diagnosis) button.textContent = diagnosis.installedApk ? "ZAINSTALUJ PONOWNIE APK" : "ZAINSTALUJ APK";
  }
});

$("#install").addEventListener("click", async () => {
  if (!diagnosis?.serial) return;
  if (rebootReady) {
    rebootReady = false;
    $("#install").disabled = true;
    $("#install").textContent = "URUCHAMIAM...";
    try { await api.reboot(diagnosis.serial); notify("Telefon uruchamia się ponownie."); }
    catch (error) { notify(error.message, true); $("#install").disabled = false; $("#install").textContent = "URUCHOM TELEFON PONOWNIE"; rebootReady = true; }
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
    $("#install").textContent = "URUCHOM TELEFON PONOWNIE";
    $("#install").disabled = false;
    rebootReady = true;
  } catch (error) { notify(error.message, true); $("#install").disabled = false; $("#install").textContent = "ZAINSTALUJ ZESTAW"; }
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
api.status().then(({ state }) => { if (state.serial) api.diagnose(state.serial).then(render).catch(() => renderRuntimeState(state)); else renderRuntimeState(state); });
api.onUpdateStatus((state) => notify(state.error || state.message || "Stan aktualizacji zmieniony", Boolean(state.error)));
