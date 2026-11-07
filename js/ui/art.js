/* Moni Money's illustrations (Phase 7C).

   A small, original set drawn in code: inline SVG, a few kilobytes each, no image files to download.
   Every colour comes from the theme (classes styled in css/app.css, "ART" section), so the drawings
   follow light and dark mode and each person's own accent colour. They are decoration only: always
   aria-hidden, and the words around them say everything that matters.

   Motifs: coins, a savings jar, two overlapping circles (shared money), a wallet with layered cards,
   a target that coins travel towards, a growth line, and a small plant growing from savings. */

/** A stack of coins: n coins, centred on cx, sitting on y. Drawn bottom up so each coin overlaps the one below. */
function stack(cx, y, n, rx = 17, ry = 5.5, h = 6.5) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const b = y - i * h, t = b - h;
    s += `<path class="ar-coin-e" d="M${cx - rx} ${t}v${h}a${rx} ${ry} 0 0 0 ${rx * 2} 0v-${h}z"/><ellipse class="ar-coin" cx="${cx}" cy="${t}" rx="${rx}" ry="${ry}"/>`;
  }
  const top = y - n * h;
  return s + `<ellipse class="ar-coin-i" cx="${cx}" cy="${top}" rx="${rx * 0.62}" ry="${ry * 0.6}"/>`;
}
/** One coin seen face on, slightly turned. */
const coin = (cx, cy, r, tilt = 0, cls = "") => `<g class="${cls}" transform="translate(${cx} ${cy}) rotate(${tilt})"><ellipse class="ar-coin-e" cx="1.6" cy="1.2" rx="${r * 0.82}" ry="${r}"/><ellipse class="ar-coin" rx="${r * 0.82}" ry="${r}"/><ellipse class="ar-coin-i" rx="${r * 0.5}" ry="${r * 0.64}"/></g>`;
const spark = (x, y, s = 1, cls = "ar-spark") => `<path class="${cls}" transform="translate(${x} ${y}) scale(${s})" d="M0-7C.8-2 2-.8 7 0 2 .8.8 2 0 7-.8 2-2 .8-7 0-2-.8-.8-2 0-7z"/>`;
const svg = (name, inner, vb = "0 0 240 160") => `<svg class="art art-${name}" viewBox="${vb}" aria-hidden="true" focusable="false">${inner}</svg>`;

export const ART = {
  /** Step 1: two people's money, overlapping where it's shared. */
  together: () => svg("together", `
    <ellipse class="ar-bg" cx="120" cy="86" rx="104" ry="64"/>
    <circle class="ar-a" cx="98" cy="82" r="46"/>
    <circle class="ar-j" cx="142" cy="82" r="46"/>
    <path class="ar-mix" d="M120 41.3a46 46 0 0 1 0 81.4 46 46 0 0 1 0-81.4z"/>
    ${coin(120, 82, 15, -8)}
    ${coin(46, 40, 9, 14, "ar-float")}
    ${coin(196, 128, 8, -18, "ar-float d2")}
    ${spark(200, 38, 1.1)}${spark(34, 118, .8, "ar-spark j")}`),

  /** Step 2 (income): a savings jar filling up, with a coin on its way in. */
  jar: () => svg("jar", `
    <ellipse class="ar-bg" cx="120" cy="92" rx="104" ry="60"/>
    <ellipse class="ar-shadow" cx="112" cy="146" rx="62" ry="6"/>
    <path class="ar-glass" d="M80 52h64v8c14 6 22 18 22 34v34c0 9-7 16-16 16H74c-9 0-16-7-16-16V94c0-16 8-28 22-34z"/>
    <g class="ar-jar-in">${stack(92, 140, 3, 15, 5, 6)}${stack(126, 140, 5, 15, 5, 6)}</g>
    <path class="ar-glass-hi" d="M70 98c0-10 4-18 11-23"/>
    <rect class="ar-lid" x="74" y="40" width="76" height="14" rx="6"/>
    ${coin(112, 18, 11, 0, "ar-drop")}
    ${stack(194, 146, 4, 16, 5.2, 6.4)}
    ${spark(44, 52, 1)}${spark(206, 40, .8, "ar-spark j")}`),

  /** Done: a small plant growing out of savings, with a tick. */
  grow: () => svg("grow", `
    <ellipse class="ar-bg" cx="120" cy="94" rx="108" ry="62"/>
    <ellipse class="ar-shadow" cx="120" cy="150" rx="70" ry="6"/>
    ${stack(62, 148, 3, 15, 5, 6)}${stack(178, 148, 4, 15, 5, 6)}
    <path class="ar-pot" d="M92 104h56l-7 40c-1 4-4 6-8 6h-26c-4 0-7-2-8-6z"/>
    <rect class="ar-pot-rim" x="86" y="96" width="68" height="14" rx="6"/>
    <path class="ar-stem" d="M120 98C120 80 118 64 122 44"/>
    <path class="ar-leaf l1" d="M121 74c-4-14-18-20-30-16 3 13 16 20 30 16z"/>
    <path class="ar-leaf l2" d="M121 62c4-15 18-22 31-18-3 14-17 22-31 18z"/>
    <g class="ar-bloom">${coin(122, 38, 12, 0)}</g>
    <g class="ar-burst" aria-hidden="true"><circle class="b1" cx="62" cy="40" r="4"/><circle class="b2" cx="182" cy="34" r="3.5"/><circle class="b3" cx="40" cy="92" r="3"/><circle class="b4" cx="204" cy="86" r="4"/>${spark(84, 22, .9)}${spark(160, 16, .8, "ar-spark j")}</g>`),

  /** Net worth, nothing added yet: a wallet with cards. */
  wallet: () => svg("wallet", `
    <ellipse class="ar-bg" cx="120" cy="88" rx="100" ry="58"/>
    <ellipse class="ar-shadow" cx="118" cy="146" rx="66" ry="6"/>
    <rect class="ar-card c1" x="66" y="34" width="92" height="58" rx="10" transform="rotate(-9 112 63)"/>
    <rect class="ar-card c2" x="84" y="28" width="92" height="58" rx="10" transform="rotate(7 130 57)"/>
    <rect class="ar-wal" x="52" y="62" width="136" height="80" rx="18"/>
    <rect class="ar-wal-flap" x="146" y="88" width="50" height="30" rx="12"/>
    <circle class="ar-wal-dot" cx="163" cy="103" r="5"/>
    ${stack(206, 148, 2, 14, 4.6, 6)}
    ${spark(42, 46, 1)}${spark(202, 40, .8, "ar-spark j")}`),

  /** Goals: coins travelling towards a target. */
  target: () => svg("target", `
    <ellipse class="ar-bg" cx="120" cy="86" rx="100" ry="60"/>
    <circle class="ar-ring r1" cx="146" cy="80" r="50"/>
    <circle class="ar-ring r2" cx="146" cy="80" r="33"/>
    <circle class="ar-ring r3" cx="146" cy="80" r="16"/>
    <path class="ar-trail" d="M36 120c30-4 56-18 78-36"/>
    ${coin(60, 112, 10, -10)}${coin(96, 92, 12, -6)}
    ${spark(206, 30, 1)}${spark(40, 54, .8, "ar-spark j")}`),

  /** Progress and Invest: a line that grows, one point at a time. */
  growth: () => svg("growth", `
    <ellipse class="ar-bg" cx="120" cy="88" rx="104" ry="60"/>
    <rect class="ar-panel" x="48" y="32" width="144" height="104" rx="16"/>
    <rect class="ar-bar" x="66" y="104" width="16" height="18" rx="4"/><rect class="ar-bar" x="92" y="92" width="16" height="30" rx="4"/><rect class="ar-bar" x="118" y="80" width="16" height="42" rx="4"/><rect class="ar-bar" x="144" y="62" width="16" height="60" rx="4"/>
    <path class="ar-line" d="M66 96l26-14 26 4 26-24 30-16"/>
    <circle class="ar-dot" cx="174" cy="46" r="6"/>
    ${stack(208, 146, 3, 13, 4.4, 6)}
    ${spark(36, 50, 1)}${spark(206, 30, .7, "ar-spark j")}`),
};
