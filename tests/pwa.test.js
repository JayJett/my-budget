/* The installable-app pieces: manifest, icons, splash screens, and the service worker's file list. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { isCurrent, appFiles } from "../tools/sw-version.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = f => readFile(ROOT + f);
/** Width and height of a PNG, read from its header. */
async function pngSize(f) {
  const b = await read(f);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${f} is a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("the manifest has what phones need to install the app", async () => {
  const m = JSON.parse(await read("manifest.webmanifest"));
  assert.equal(m.name, "My Budget");
  assert.ok(m.short_name.length <= 12, "short enough to fit under the icon");
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "./"); assert.equal(m.scope, "./");
  assert.match(m.theme_color, /^#[0-9A-F]{6}$/i); assert.match(m.background_color, /^#[0-9A-F]{6}$/i);
  const sizes = Object.fromEntries(await Promise.all(m.icons.map(async i => [i.src + " " + i.purpose, (await pngSize(i.src)).join("x")])));
  assert.equal(sizes["icons/icon-192.png any"], "192x192");
  assert.equal(sizes["icons/icon-512.png any"], "512x512");
  assert.equal(sizes["icons/maskable-512.png maskable"], "512x512");
});

test("iPhone home-screen icon, full screen and splash screens", async () => {
  const html = (await read("index.html")).toString();
  assert.deepEqual(await pngSize("icons/apple-touch-icon.png"), [180, 180]);
  for (const tag of ['rel="manifest"', 'name="apple-mobile-web-app-capable" content="yes"', 'name="apple-mobile-web-app-title" content="My Budget"', 'rel="apple-touch-icon"', 'name="theme-color"', "viewport-fit=cover"])
    assert.ok(html.includes(tag), tag);
  const splashes = [...html.matchAll(/rel="apple-touch-startup-image" href="([^"]+)" media="\(device-width: (\d+)px\) and \(device-height: (\d+)px\) and \(-webkit-device-pixel-ratio: (\d)\)/g)];
  assert.ok(splashes.length >= 8, "covers current iPhone sizes");
  for (const [, file, w, h, r] of splashes) assert.deepEqual(await pngSize(file), [w * r, h * r], file);
});

test("the app no longer depends on a CDN to start (works offline)", async () => {
  const html = (await read("index.html")).toString();
  assert.ok(!/<script[^>]+src="https?:/.test(html), "every script is served by the app itself");
  await access(ROOT + "vendor/supabase-js-2.45.4/supabase.js");
});

test("the service worker stores every file the app needs, and its version is current", async () => {
  assert.ok(await isCurrent(), "sw.js is out of date: run  node tools/sw-version.mjs");
  const files = await appFiles();
  for (const f of ["index.html", "css/app.css", "js/main.js", "js/sync/store.js", "manifest.webmanifest", "vendor/supabase-js-2.45.4/supabase.js", "icons/icon-192.png"]) assert.ok(files.includes(f), f);
  // Every module the app imports must be stored, or the app would break offline.
  const sw = (await read("sw.js")).toString();
  for (const f of files.filter(f => f.startsWith("js/"))) assert.ok(sw.includes(`"./${f}"`), f);
});
