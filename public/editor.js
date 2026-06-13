const $ = (selector) => document.querySelector(selector);
const preview = $("#deck-preview");
const tabs = $("#page-tabs");
const toast = $("#studio-toast");
let config;
let pageName = "home";
let selectedIndex = 0;
let toastTimer;

const iconGlyphs = { discord:"◖◗", micOff:"⌁", headset:"◉", video:"▣", spotify:"◎", volumeDown:"◁", volumeUp:"▷", play:"▶", next:"▶|", previous:"|◀", terminal:">_", folder:"▱", crop:"⌜", sliders:"≡", automation:"☷", rocket:"↗", code:"</>", activity:"⌁", inspect:"⌗", display:"▭", lock:"▢", copy:"▣", paste:"▤", undo:"↶", redo:"↷", back:"←", github:"◉", save:"▣", command:"⌘", search:"⌕", volumeMute:"×" };

function notify(message, error = false) { clearTimeout(toastTimer); toast.textContent = message; toast.className = `studio-toast show${error ? " error" : ""}`; toastTimer = setTimeout(() => toast.className = "studio-toast", 1800); }
function buttons() { return config.pages[pageName].buttons; }
function selected() { return buttons()[selectedIndex]; }

function renderTabs() {
  tabs.replaceChildren(...Object.entries(config.pages).map(([name, page]) => {
    const button = document.createElement("button"); button.textContent = page.label; button.classList.toggle("active", name === pageName);
    button.addEventListener("click", () => { pageName = name; selectedIndex = 0; renderAll(); }); return button;
  }));
}

function renderPreview() {
  preview.replaceChildren(...buttons().map((button, index) => {
    const tile = document.createElement("button"); tile.className = `preview-tile tone-${button.tone || "neutral"}`; tile.classList.toggle("selected", index === selectedIndex);
    const icon = document.createElement("span"); icon.className = "preview-icon"; icon.textContent = iconGlyphs[button.icon] || "◆";
    const label = document.createElement("strong"); label.textContent = button.label;
    const hint = document.createElement("small"); hint.textContent = button.hint || "";
    tile.append(icon, label, hint); tile.addEventListener("click", () => { selectedIndex = index; renderPreview(); loadTile(); }); return tile;
  }));
}

function actionLabels(type) {
  return {
    hotkey:["Klawisze","Nie używane"], processHotkey:["Nazwa procesu","Klawisze"], launch:["Program lub URL","Argumenty JSON"],
    command:["Polecenie","Argumenty JSON"], media:["Nazwa klawisza","Nie używane"], page:["Nazwa strony","Nie używane"], sequence:["Sekwencja","Lista akcji JSON"]
  }[type];
}

function updateCaptions() { const labels = actionLabels($("#tile-type").value); $("#primary-caption").textContent = labels[0]; $("#detail-caption").textContent = labels[1]; }

function loadTile() {
  const button = selected(); const action = button.action;
  $("#selected-id").textContent = button.id; $("#tile-label").value = button.label; $("#tile-hint").value = button.hint || ""; $("#tile-icon").value = button.icon; $("#tile-tone").value = button.tone || "neutral"; $("#tile-type").value = action.type;
  $("#tile-primary").value = action.type === "hotkey" ? (action.keys || []).join(" + ") : action.type === "processHotkey" ? action.process || "" : action.type === "media" ? action.key || "" : action.type === "page" ? action.page || "" : action.command || "";
  $("#tile-detail").value = action.type === "processHotkey" ? (action.keys || []).join(" + ") : action.type === "sequence" ? JSON.stringify(action.actions || [], null, 2) : ["launch","command"].includes(action.type) ? JSON.stringify(action.args || []) : "";
  updateCaptions();
}

function parseKeys(value) { return value.split(/[+,\s]+/).filter(Boolean).map((key) => key.toUpperCase()); }
function readAction() { const type=$("#tile-type").value, primary=$("#tile-primary").value.trim(), detail=$("#tile-detail").value.trim(); if(type==="hotkey")return{type,keys:parseKeys(primary)}; if(type==="processHotkey")return{type,process:primary,keys:parseKeys(detail)}; if(type==="media")return{type,key:primary}; if(type==="page")return{type,page:primary}; if(type==="sequence")return{type,actions:JSON.parse(detail||"[]")}; return{type,command:primary,args:JSON.parse(detail||"[]")}; }

function applyTile(event) { event?.preventDefault(); try { const button=selected(); button.label=$("#tile-label").value.trim(); button.hint=$("#tile-hint").value.trim(); button.icon=$("#tile-icon").value; button.tone=$("#tile-tone").value; button.action=readAction(); renderPreview(); notify("Kafel zaktualizowany w podglądzie"); } catch(error){ notify(error.message,true); } }
function move(offset){ const list=buttons(), target=selectedIndex+offset; if(target<0||target>=list.length)return; [list[selectedIndex],list[target]]=[list[target],list[selectedIndex]]; selectedIndex=target; renderPreview(); loadTile(); }

function renderAll(){ renderTabs(); renderPreview(); loadTile(); }
function loadGlobals(){ $("#global-accent").value=config.accent; $("#accent-value").textContent=config.accent; $("#global-dim").value=config.ui?.dimAfterSeconds??90; $("#global-saver").value=config.ui?.screensaverAfterSeconds??300; $("#weather-city").value=config.weather?.city??"Warszawa"; $("#weather-lat").value=config.weather?.latitude??52.2297; $("#weather-lon").value=config.weather?.longitude??21.0122; document.documentElement.style.setProperty("--accent",config.accent); }
function readGlobals(){ config.accent=$("#global-accent").value; config.ui={dimAfterSeconds:Number($("#global-dim").value),screensaverAfterSeconds:Number($("#global-saver").value)}; config.weather={city:$("#weather-city").value.trim(),latitude:Number($("#weather-lat").value),longitude:Number($("#weather-lon").value)}; }

async function save(){ try{ applyTile(); readGlobals(); const response=await fetch("/api/config",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(config)}); const result=await response.json(); if(!response.ok)throw new Error(result.error||"Nie udało się zapisać"); config=result.config; notify("Konfiguracja zapisana na EndoDeck"); }catch(error){notify(error.message,true)} }
function updateConnection(state){ const card=$(".connection-card"); card.classList.toggle("online",Boolean(state.adb)); $("#connection-label").textContent=state.adb?"TELEFON PODŁĄCZONY":"TELEFON OFFLINE"; $("#connection-detail").textContent=state.adb?`${state.battery?.percent??"--"}% · ${state.battery?.currentMa??"--"} mA`:"Podłącz przewód USB"; }

async function boot(){ config=await fetch("/api/config").then(r=>r.json()); $("#tile-icon").replaceChildren(...Object.keys(iconGlyphs).map(name=>new Option(name,name))); loadGlobals(); renderAll(); updateConnection(await fetch("/api/state").then(r=>r.json())); new EventSource("/api/events").addEventListener("message",event=>updateConnection(JSON.parse(event.data))); }

$("#tile-form").addEventListener("submit",applyTile); $("#tile-type").addEventListener("change",updateCaptions); $("#move-left").addEventListener("click",()=>move(-1)); $("#move-right").addEventListener("click",()=>move(1)); $("#save-config").addEventListener("click",save); $("#global-accent").addEventListener("input",event=>{ $("#accent-value").textContent=event.target.value; document.documentElement.style.setProperty("--accent",event.target.value); });
boot().catch(error=>notify(error.message,true));
