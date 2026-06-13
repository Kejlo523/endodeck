import { cp, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as solid from "@fortawesome/free-solid-svg-icons";
import * as brands from "@fortawesome/free-brands-svg-icons";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDir = join(root, "public", "vendor", "leaflet");

const wanted = [
  "discord", "spotify", "github", "windows", "android", "apple", "chrome", "firefox-browser", "edge",
  "code", "terminal", "folder", "folder-open", "file", "floppy-disk", "scissors", "crop-simple", "copy", "paste",
  "trash", "download", "upload", "link", "globe", "house", "arrow-left", "arrow-right", "arrow-up", "arrow-down",
  "rotate-left", "rotate-right", "arrows-rotate", "magnifying-glass", "bars", "table-cells-large", "list", "plus", "minus",
  "check", "xmark", "play", "pause", "forward-step", "backward-step", "forward", "backward", "shuffle", "repeat",
  "volume-low", "volume-high", "volume-xmark", "microphone", "microphone-slash", "headphones", "headset", "video",
  "video-slash", "camera", "music", "sliders", "sliders-up", "wave-square", "radio", "podcast",
  "display", "desktop", "laptop", "keyboard", "computer-mouse", "gamepad", "mobile-screen", "tablet-screen-button",
  "gear", "gears", "wrench", "screwdriver-wrench", "palette", "wand-magic-sparkles", "bolt", "rocket", "power-off",
  "lock", "unlock", "shield-halved", "key", "fingerprint", "eye", "eye-slash", "bug", "code-branch", "database",
  "server", "network-wired", "hard-drive", "memory", "microchip", "chart-line", "chart-simple", "gauge-high",
  "clock", "calendar", "calendar-days", "bell", "bell-slash", "stopwatch", "hourglass-half", "cloud", "cloud-sun",
  "sun", "moon", "temperature-half", "droplet", "wind", "snowflake", "umbrella", "battery-full", "battery-half",
  "plug", "wifi", "bluetooth", "plane", "signal", "location-dot", "map", "map-location-dot", "compass",
  "image", "images", "print", "envelope", "comment", "comments", "phone", "user", "users", "user-group",
  "heart", "star", "bookmark", "flag", "circle-info", "circle-question", "circle-exclamation", "triangle-exclamation"
];

const aliases = {
  micOff: "microphone-slash", headset: "headphones", volumeDown: "volume-low", volumeUp: "volume-high",
  volumeMute: "volume-xmark", next: "forward-step", previous: "backward-step", back: "arrow-left",
  automation: "wand-magic-sparkles", activity: "chart-line", inspect: "bug", crop: "crop-simple"
};

const available = new Map(
  [...Object.values(solid), ...Object.values(brands)]
    .filter((icon) => icon?.iconName && icon?.icon)
    .map((icon) => [icon.iconName, icon])
);
const icons = {};
for (const name of wanted) {
  const icon = available.get(name);
  if (!icon) continue;
  const [width, height, , , data] = icon.icon;
  icons[name] = { viewBox: `0 0 ${width} ${height}`, paths: Array.isArray(data) ? data : [data] };
}

await mkdir(vendorDir, { recursive: true });
await cp(join(root, "node_modules", "leaflet", "dist", "leaflet.css"), join(vendorDir, "leaflet.css"));
await cp(join(root, "node_modules", "leaflet", "dist", "leaflet.js"), join(vendorDir, "leaflet.js"));
await cp(join(root, "node_modules", "leaflet", "dist", "images"), join(vendorDir, "images"), { recursive: true });
await writeFile(
  join(root, "public", "icons.js"),
  `export const ICONS = ${JSON.stringify(icons)};\nexport const ICON_ALIASES = ${JSON.stringify(aliases)};\n`,
  "utf8"
);

console.log(`Prepared ${Object.keys(icons).length} Font Awesome icons and Leaflet assets.`);
