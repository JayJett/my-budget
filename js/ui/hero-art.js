/* The big illustrations on the dark welcome, sign-in and setup screens (Phase 7C redesign).

   Original artwork drawn in code (inline SVG, a few kB each): glossy spheres, a twisted ring, coins,
   glass and stepped pedestals, lit from the top left so they read as soft 3D shapes. These screens are
   always dark, so the colours are fixed rather than following the theme. Decoration only: aria-hidden,
   and the words beside them carry the meaning. Nothing moves continuously; a few pieces drift in once. */

let uid = 0;
const C = { mint: "#8FE0B9", teal: "#2FA88F", lilac: "#B9A6F5", lilacD: "#6B58B8", peach: "#F6A98A", peachD: "#C8603F", gold: "#F7CB62", goldD: "#C9901F", cream: "#FFF6E4", deep: "#0A221D", navy: "#183A44" };

/** Shared gradients for one drawing (ids are unique per drawing, so several can be on a page). */
function defs(p) {
  const sphere = (id, base, dark) => `<radialGradient id="${p}${id}" cx="34%" cy="28%" r="78%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".22" stop-color="${base}"/><stop offset=".78" stop-color="${dark}"/><stop offset="1" stop-color="${C.deep}"/></radialGradient>`;
  return `<defs>
    <radialGradient id="${p}glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${C.teal}" stop-opacity=".55"/><stop offset=".6" stop-color="${C.teal}" stop-opacity=".12"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/></radialGradient>
    ${sphere("sm", C.mint, C.teal)}${sphere("sl", C.lilac, C.lilacD)}${sphere("sp", C.peach, C.peachD)}${sphere("sg", C.gold, C.goldD)}
    <linearGradient id="${p}coin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset=".55" stop-color="${C.gold}"/><stop offset="1" stop-color="${C.goldD}"/></linearGradient>
    <linearGradient id="${p}ring" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.lilac}"/><stop offset=".5" stop-color="#C9B8FF"/><stop offset=".78" stop-color="${C.peach}"/><stop offset="1" stop-color="#F07E6A"/></linearGradient>
    <linearGradient id="${p}glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".5" stop-color="#fff" stop-opacity=".06"/><stop offset="1" stop-color="#fff" stop-opacity=".16"/></linearGradient>
    <linearGradient id="${p}tall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.peach}"/><stop offset="1" stop-color="${C.lilac}"/></linearGradient>
  </defs>`;
}
const ball = (p, x, y, r, g = "sm", cls = "") => `<circle class="${cls}" cx="${x}" cy="${y}" r="${r}" fill="url(#${p}${g})"/>`;
const glow = (p, x, y, rx, ry) => `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${p}glow)"/>`;
/** A coin, slightly turned: rim, face, inner ring and a dollar sign. */
const coin = (p, x, y, r, tilt = 0, cls = "") => `<g class="${cls}" transform="translate(${x} ${y}) rotate(${tilt})">
  <ellipse cx="${r * 0.16}" cy="0" rx="${r * 0.86}" ry="${r}" fill="${C.goldD}"/>
  <ellipse rx="${r * 0.86}" ry="${r}" fill="url(#${p}coin)"/>
  <ellipse rx="${r * 0.6}" ry="${r * 0.72}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="${Math.max(1, r * 0.08)}"/>
  <text x="0" y="${r * 0.36}" text-anchor="middle" font-size="${r * 1.05}" font-weight="800" font-family="-apple-system, system-ui, sans-serif" fill="${C.goldD}">$</text></g>`;
/** A small spiky burst (a bit of sparkle). */
function burst(x, y, r, fill = C.cream) {
  let d = ""; for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r; d += `${i ? "L" : "M"}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`; }
  return `<path d="${d}Z" fill="${fill}"/>`;
}
const spark = (x, y, s = 1, fill = C.cream) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-8C1-2 2-1 8 0 2 1 1 2 0 8-1 2-2 1-8 0-2-1-1-2 0-8z" fill="${fill}"/>`;
/** A thin orbit line with an arrowhead: money going round. */
const orbit = (d, ax, ay, rot) => `<path d="${d}" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/><path transform="translate(${ax} ${ay}) rotate(${rot})" d="M-4-3L4 0-4 3z" fill="#fff" fill-opacity=".55"/>`;
/** A stepped pedestal seen from above at an angle (top, left and right faces). */
function prism(cx, base, w, h, top, left, right) {
  const t = base - h, q = w / 4;
  return `<path d="M${cx - w / 2} ${t}L${cx} ${t + q}L${cx} ${base + q}L${cx - w / 2} ${base}Z" fill="${left}"/>
    <path d="M${cx} ${t + q}L${cx + w / 2} ${t}L${cx + w / 2} ${base}L${cx} ${base + q}Z" fill="${right}"/>
    <path d="M${cx} ${t - q}L${cx + w / 2} ${t}L${cx} ${t + q}L${cx - w / 2} ${t}Z" fill="${top}"/>`;
}
const svg = (name, inner) => { const p = `ha${++uid}`; return `<svg class="hart hart-${name}" viewBox="0 0 300 260" aria-hidden="true" focusable="false">${defs(p)}${inner(p)}</svg>`; };

export const HERO = {
  /** "Give every dollar a job": a twisted ring around a coin in a glass bubble. */
  plan: () => svg("plan", p => `
    ${glow(p, 150, 130, 140, 120)}
    ${orbit("M44 176A112 112 0 0 1 98 32", 98, 32, -60)}${orbit("M256 84A112 112 0 0 1 202 228", 202, 228, 120)}
    <circle cx="150" cy="130" r="74" fill="none" stroke="url(#${p}ring)" stroke-width="36"/>
    <circle cx="150" cy="130" r="74" fill="none" stroke="#fff" stroke-opacity=".16" stroke-width="36" stroke-dasharray="9 13"/>
    <circle cx="150" cy="130" r="88" fill="none" stroke="${C.deep}" stroke-opacity=".28" stroke-width="7"/>
    <circle cx="150" cy="130" r="61" fill="none" stroke="#fff" stroke-opacity=".28" stroke-width="5"/>
    <path d="M96 84A74 74 0 0 1 180 62" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="5" stroke-linecap="round"/>
    <circle cx="150" cy="130" r="36" fill="url(#${p}glass)" stroke="#fff" stroke-opacity=".4" stroke-width="1.5"/>
    ${coin(p, 150, 131, 21, -10, "hp-pop")}
    <path d="M128 112a30 30 0 0 1 22-12" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/>
    ${ball(p, 102, 64, 9, "sl", "hp-a")}${ball(p, 214, 170, 7, "sm", "hp-b")}${ball(p, 92, 196, 6, "sp", "hp-a")}${ball(p, 206, 64, 5, "sg", "hp-b")}
    ${spark(238, 40, 1)}${spark(58, 92, .7, C.mint)}`),

  /** "Better together": two people's money, two glossy spheres that overlap. */
  together: () => svg("together", p => `
    ${glow(p, 150, 130, 140, 118)}
    ${orbit("M248 70A118 118 0 0 1 238 196", 238, 196, 100)}
    ${ball(p, 122, 128, 66, "sl")}
    <g opacity=".95">${ball(p, 190, 112, 50, "sm")}</g>
    <clipPath id="${p}clip"><circle cx="122" cy="128" r="66"/></clipPath>
    <circle cx="190" cy="112" r="50" fill="#fff" fill-opacity=".22" clip-path="url(#${p}clip)"/>
    ${coin(p, 204, 196, 28, -14, "hp-pop")}
    ${burst(86, 214, 18)}
    ${ball(p, 64, 70, 8, "sg", "hp-a")}${ball(p, 240, 46, 6, "sp", "hp-b")}${ball(p, 50, 168, 5, "sm", "hp-b")}
    ${spark(110, 40, .9)}${spark(262, 128, .7, C.lilac)}`),

  /** "Watch it grow": stepped pedestals, a coin rising from the tallest. */
  grow: () => svg("grow", p => `
    ${glow(p, 160, 150, 140, 110)}
    ${prism(84, 214, 70, 40, "#2E5560", C.navy, "#10303A")}
    ${prism(150, 222, 76, 74, "#D6CBFF", C.lilac, "#8E79DA")}
    ${prism(220, 210, 78, 118, "#FFD1BF", `url(#${p}tall)`, "#9C86E6")}
    ${burst(84, 160, 16)}
    <path d="M150 128V70" stroke="#fff" stroke-opacity=".6" stroke-width="1.6"/><path d="M146 76l4-8 4 8z" fill="#fff" fill-opacity=".8"/>
    ${ball(p, 150, 132, 14, "sm")}
    ${glow(p, 220, 66, 44, 36)}
    ${coin(p, 220, 60, 26, 0, "hp-rise")}
    ${ball(p, 260, 150, 6, "sg", "hp-a")}${ball(p, 40, 120, 7, "sl", "hp-b")}
    ${spark(272, 40, .9)}${spark(46, 70, .7, C.mint)}`),

  /** Setup, your income: a glass jar filling with coins, one on its way in. */
  jar: () => svg("jar", p => `
    ${glow(p, 150, 140, 136, 112)}
    <ellipse cx="150" cy="230" rx="78" ry="9" fill="#000" fill-opacity=".25"/>
    ${[[126, 214], [150, 220], [174, 214], [138, 196], [162, 198], [150, 178]].map(([x, y], i) => `<g transform="translate(${x} ${y})"><ellipse cy="5" rx="22" ry="8" fill="${C.goldD}"/><ellipse rx="22" ry="8" fill="url(#${p}coin)"/><ellipse rx="13" ry="4.5" fill="none" stroke="#fff" stroke-opacity=".5" stroke-width="1.4"/></g>`).join("")}
    <path d="M110 70h80v14c22 10 34 30 34 54v62c0 16-12 28-28 28h-92c-16 0-28-12-28-28v-62c0-24 12-44 34-54z" fill="url(#${p}glass)" stroke="#fff" stroke-opacity=".45" stroke-width="2"/>
    <path d="M92 142c0-22 10-38 26-46" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="5" stroke-linecap="round"/>
    <rect x="102" y="52" width="96" height="22" rx="9" fill="url(#${p}sm)"/>
    ${coin(p, 150, 26, 17, 12, "hp-drop")}
    <path d="M128 18v12M172 14v10" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" stroke-linecap="round"/>
    ${ball(p, 246, 112, 8, "sl", "hp-a")}${ball(p, 58, 196, 6, "sp", "hp-b")}${ball(p, 62, 72, 5, "sg", "hp-b")}
    ${spark(244, 52, .9)}${spark(48, 128, .7, C.mint)}`),
};
