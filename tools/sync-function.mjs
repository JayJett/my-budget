/* Copies the app's money maths (js/model/) into the daily reminders function, so the reminders it
   sends always match what the app shows. Run after changing anything in js/model/:
     node tools/sync-function.mjs          (copy)
     node tools/sync-function.mjs --check  (fail if the copies are out of date; the tests run this) */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const FILES = ["reminders.js", "calc.js", "migrate.js", "schema.js", "util.js", "periods.js", "format.js", "paydate.js"];
const from = new URL("../js/model/", import.meta.url), to = new URL("../supabase/functions/send-reminders/model/", import.meta.url);
const NOTE = "// COPY of js/model/ — don't edit here. Change js/model/ and run: node tools/sync-function.mjs\n";

export function stale() {
  return FILES.filter(f => !existsSync(new URL(f, to)) || readFileSync(new URL(f, to), "utf8") !== NOTE + readFileSync(new URL(f, from), "utf8"));
}
if (process.argv[1] && process.argv[1].endsWith("sync-function.mjs")) {
  if (process.argv.includes("--check")) {
    const s = stale();
    if (s.length) { console.error("Out of date in the function: " + s.join(", ") + ". Run: node tools/sync-function.mjs"); process.exit(1); }
    console.log("Function copies are up to date");
  } else {
    mkdirSync(to, { recursive: true });
    FILES.forEach(f => writeFileSync(new URL(f, to), NOTE + readFileSync(new URL(f, from), "utf8")));
    console.log(`Copied ${FILES.length} files into supabase/functions/send-reminders/model/`);
  }
}
