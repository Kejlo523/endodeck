import { ICONS, ICON_ALIASES } from "./icons.js";

export const iconNames = Object.keys(ICONS).sort((a, b) => a.localeCompare(b));

export function resolveIcon(name) {
  const resolved = ICON_ALIASES[name] ?? name;
  return ICONS[resolved] ? resolved : "wand-magic-sparkles";
}

export function iconSvg(name, className = "") {
  const resolved = resolveIcon(name);
  const icon = ICONS[resolved];
  return `<svg class="${className}" viewBox="${icon.viewBox}" aria-hidden="true">${icon.paths.map((path) => `<path d="${path}"></path>`).join("")}</svg>`;
}

export function renderIconPicker(container, query, selected, onSelect) {
  const clean = String(query ?? "").trim().toLowerCase();
  const matches = iconNames.filter((name) => !clean || name.includes(clean)).slice(0, 72);
  const fragment = document.createDocumentFragment();
  for (const name of matches) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `icon-choice${resolveIcon(selected) === name ? " selected" : ""}`;
    button.title = name;
    button.setAttribute("aria-label", name);
    button.innerHTML = `${iconSvg(name)}<span>${name}</span>`;
    button.addEventListener("click", () => onSelect(name));
    fragment.append(button);
  }
  container.replaceChildren(fragment);
  if (!matches.length) container.innerHTML = '<div class="icon-empty">Brak ikon dla tego hasła</div>';
}
