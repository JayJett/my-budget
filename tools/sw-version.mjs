/* Fills in the file list and version at the top of sw.js.
     node tools/sw-version.mjs          update sw.js
     node tools/sw-version.mjs --check  exit with an error if sw.js is out of date (used by the tests)
   The version is a fingerprint of every stored file, so it changes whenever any of them changes. */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, sep } from "node:path";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
async function walk(dir) {
  const out = [];
  for (const e of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}
export async function appFiles() {
  const js = (await walk("js")).filter(f => f.endsWith(".js"));
  const vendor = (await walk("vendor")).filter(f => f.endsWith(".js"));
  const icons = ["icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png", "icons/favicon-32.png"];
  return ["index.html", "manifest.webmanifest", "css/app.css", ...js, ...vendor, ...icons].map(f => f.split(sep).join("/")).sort();
}
export async function expected() {
  const files = await appFiles(), h = createHash("sha256");
  for (const f of files) { h.update(f + "\n"); h.update(await readFile(join(ROOT, f))); }
  const version = h.digest("hex").slice(0, 12);
  return `// --- generated: start ---\nconst VERSION = "${version}";\nconst FILES = ${JSON.stringify(["./", ...files.map(f => "./" + f)], null, 1).replace(/\n\s*/g, " ")};\n// --- generated: end ---`;
}
const BLOCK = /\/\/ --- generated: start ---[\s\S]*?\/\/ --- generated: end ---/;
export async function isCurrent() {
  const sw = await readFile(join(ROOT, "sw.js"), "utf8");
  return (sw.match(BLOCK) || [""])[0] === await expected();
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--check")) {
    if (!(await isCurrent())) { console.error("sw.js is out of date. Run: node tools/sw-version.mjs"); process.exit(1); }
    console.log("sw.js is up to date.");
  } else {
    const sw = await readFile(join(ROOT, "sw.js"), "utf8");
    await writeFile(join(ROOT, "sw.js"), sw.replace(BLOCK, await expected()));
    console.log("sw.js updated:", (await expected()).match(/VERSION = "(\w+)"/)[1]);
  }
}
