/* Makes the app icons and iPhone splash screens from one design, using the Chromium that
   Playwright already has. Run it only when the design changes:  node tools/make-icons.mjs
   (Not a build step: the generated PNGs are committed and served as they are.) */
import { createRequire } from "node:module";
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const OUT = fileURLToPath(new URL("../icons/", import.meta.url));

const GREEN = "#2F6B4F", SAGE = "#F2F4EE", BLUE = "#8AB7EA", GOLD = "#E5B85E";
/** A donut split blue / gold, centred at (c,c) with outer radius r. */
function donut(c, r) {
  const w = r * 0.36, rr = r - w / 2, circ = 2 * Math.PI * rr, gap = circ * 0.025;
  const blue = circ * 0.55 - gap, gold = circ * 0.45 - gap;
  return `<g transform="rotate(-90 ${c} ${c})" fill="none" stroke-width="${w}" stroke-linecap="butt">
    <circle cx="${c}" cy="${c}" r="${rr}" stroke="${BLUE}" stroke-dasharray="${blue} ${circ}" stroke-dashoffset="0"/>
    <circle cx="${c}" cy="${c}" r="${rr}" stroke="${GOLD}" stroke-dasharray="${gold} ${circ}" stroke-dashoffset="${-(blue + gap)}"/></g>`;
}
/** rounded: rounded corners (for browsers); scale: donut size as a share of the square. */
export const iconSVG = ({ size = 512, rounded = true, scale = 0.62 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${rounded ? size * 0.22 : 0}" fill="${GREEN}"/>${donut(size / 2, size * scale / 2)}</svg>`;

const SPLASH = [ // [css width, css height, pixel ratio]: current and recent iPhones, portrait
  [440, 956, 3], [402, 874, 3], [430, 932, 3], [393, 852, 3], [428, 926, 3],
  [390, 844, 3], [375, 812, 3], [414, 896, 3], [414, 896, 2], [375, 667, 2],
];
export const splashList = SPLASH.map(([w, h, r]) => ({ w, h, r, file: `splash-${w * r}x${h * r}.png` }));

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch(), page = await browser.newPage();
  const shot = async (html, w, h, file, scale = 1) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<html><body style="margin:0;background:transparent">${html}</body></html>`);
    await page.screenshot({ path: OUT + file, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h }, scale: "css" });
  };
  await writeFile(OUT + "icon.svg", iconSVG({ size: 512 }));
  for (const s of [192, 512]) await shot(iconSVG({ size: s }), s, s, `icon-${s}.png`);
  await shot(iconSVG({ size: 512, rounded: false, scale: 0.5 }), 512, 512, "maskable-512.png"); // Android crops to a circle/squircle
  await shot(iconSVG({ size: 180, rounded: false, scale: 0.6 }), 180, 180, "apple-touch-icon.png"); // iPhone rounds the corners itself
  await shot(iconSVG({ size: 32, scale: 0.7 }), 32, 32, "favicon-32.png");
  for (const { w, h, r, file } of splashList) {
    const W = w * r, H = h * r, icon = Math.round(W * 0.28);
    const html = `<div style="width:${W}px;height:${H}px;background:${SAGE};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(icon * 0.22)}px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
      ${iconSVG({ size: icon })}<div style="color:${GREEN};font-weight:700;font-size:${Math.round(icon * 0.2)}px;letter-spacing:-0.02em">My Budget</div></div>`;
    await shot(html, W, H, file);
  }
  await browser.close();
  console.log("Icons and splash screens written to icons/");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
