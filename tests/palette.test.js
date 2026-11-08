/* Phase 8: custom accents stay readable whatever colour is picked; object colours are clear in both modes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { accentTokens, OBJECT_COLOURS, contrast, SURFACES, isHex, tooClose } from "../js/ui/palette.js";

const PICKS = ["#FFFF00", "#FFFFFF", "#000000", "#808080", "#FF0000", "#00FF00", "#0000FF", "#FF00FF", "#00FFFF", "#F2C14E", "#123456", "#E9E9E9"];
for (const hex of PICKS) test(`a custom accent of ${hex} is adjusted until it's readable (light and dark)`, () => {
  const t = accentTokens(hex), L = SURFACES.light, D = SURFACES.dark;
  for (const bg of [L.bg, L.surface, t.light["accent-soft"]]) assert.ok(contrast(t.light.accent, bg) >= 4.5, `light ${t.light.accent} on ${bg}`);
  assert.ok(contrast(t.light["on-accent"], t.light.accent) >= 4.5); assert.ok(contrast(t.light["on-accent"], t.light["accent-hover"]) >= 4.5);
  for (const bg of [D.bg, D.surface, D.hero, L.hero, t.dark["accent-soft"]]) assert.ok(contrast(t.dark.accent, bg) >= 4.5, `dark ${t.dark.accent} on ${bg}`);
  assert.ok(contrast(t.dark["on-accent"], t.dark.accent) >= 4.5); assert.ok(contrast(t.dark["on-accent"], t.dark["accent-hover"]) >= 4.5);
  Object.values(t).forEach(m => Object.values(m).forEach(v => assert.ok(isHex(v), v)));
});
test("allocation, account, goal and household colours are clear on cards and the page, in light and dark mode", () => {
  assert.ok(OBJECT_COLOURS.length >= 10 && OBJECT_COLOURS.length <= 14);
  for (const c of OBJECT_COLOURS) {
    for (const bg of [SURFACES.light.surface, SURFACES.light.bg]) assert.ok(contrast(c.light, bg) >= 3, `${c.key} light`);
    for (const bg of [SURFACES.dark.surface, SURFACES.dark.bg]) assert.ok(contrast(c.dark, bg) >= 3, `${c.key} dark`);
  }
  assert.equal(new Set(OBJECT_COLOURS.map(c => c.key)).size, OBJECT_COLOURS.length);
});
test("the picker can warn about two colours that look alike", () => {
  assert.equal(tooClose("blue", "blue"), true);
  assert.equal(tooClose("blue", "coral"), false);
  assert.equal(tooClose("nope", "blue"), false);
});
test("the CSS has a light and dark value for every object colour", async () => {
  const css = (await import("node:fs")).readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  for (const c of OBJECT_COLOURS) {
    assert.ok(css.includes(`--o-${c.key}:${c.light};`), c.key); assert.ok(css.includes(`--o-${c.key}:${c.dark};`), c.key);
    assert.ok(css.includes(`[data-oc="${c.key}"]{ --oc:var(--o-${c.key}); }`));
  }
});
