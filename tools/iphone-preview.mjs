// Local-only visual review of the real app shell against the browser test fixture.
import { createServer as http } from "node:http";
import { createServer as https } from "node:https";
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { RICH_V3 } from "../tests/fixtures.js";
import { migrate } from "../js/model/migrate.js";
import { toStored } from "../js/model/schema.js";
import { addDays, ymd } from "../js/model/util.js";

const { values } = parseArgs({ options: {
  host: { type: "string", default: "127.0.0.1" },
  port: { type: "string", default: "4173" },
  cert: { type: "string" },
  key: { type: "string" },
} });
if (Boolean(values.cert) !== Boolean(values.key)) throw new Error("Pass both --cert and --key for HTTPS.");
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid preview port.");

const root = new URL("../", import.meta.url);
const client = "vendor/supabase-js-2.45.4/supabase.js";
const clientAssets = new Set([client, "vendor/supabase-js-2.45.4/591.supabase.js"]);
const fake = await readFile(new URL("tests/browser/fake-supabase.js", root), "utf8");
const now = new Date();
const sample = structuredClone(RICH_V3);
sample.accounts.forEach(account => {
  account.name = account.name.replace("Jarden", "Maia").replace("Madi", "Eli");
});
const budget = toStored(migrate(sample));
Object.values(budget.people).forEach((person, i) => {
  person.name = ["Maia", "Eli"][i];
  person.payday = ymd(addDays(now, -(i + 3)));
});
budget.nw.reviewed = ymd(now);
const snapshots = [3, 2, 1].map((offset, i) => {
  const month = ymd(new Date(now.getFullYear(), now.getMonth() - offset, 1));
  const nw = structuredClone(budget.nw);
  nw.accounts.n2.balance -= 800 * offset;
  return { id: i + 1, month, kind: "monthly", taken_at: month + "T12:00:00", taken_by: null,
    data: { version: 4, nw, people: budget.people, goals: budget.goals } };
});
const settings = { myName: "Maia", accent: "indigo", noAutoSnapshot: true };
const regular = { ...settings, households: [{ id: "preview-shared", name: "Harbour household · Demo", role: "owner", budget, snapshots }] };
const setup = { ...settings, households: [{ id: "preview-solo", name: "Maia’s budget · Demo", role: "owner", budget: {}, snapshots: [] }] };
const stub = "window.__FAKE_INIT = new URLSearchParams(location.search).has('setup') ? " +
  JSON.stringify(setup) + " : " + JSON.stringify(regular) + ";\n" + fake;
const contentTypes = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  webmanifest: "application/manifest+json", svg: "image/svg+xml", png: "image/png" };

async function handle(req, res) {
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; form-action 'self'; object-src 'none'");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-cache");
  if (req.method !== "GET" && req.method !== "HEAD") { res.writeHead(405).end(); return; }
  const file = (req.url || "").split("?")[0].slice(1) || "index.html";
  if (!/^(?:index\.html|sw\.js|manifest\.webmanifest|(?:css|icons|js)\/(?:[\w-]+\/)*[\w-]+\.(?:css|svg|png|js))$/.test(file) && !clientAssets.has(file)) {
    res.writeHead(404).end(); return;
  }
  try {
    const body = file === client ? stub : await readFile(new URL(file, root));
    res.writeHead(200, { "Content-Type": contentTypes[file.split(".").at(-1)] }).end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404).end();
  }
}

const server = values.cert
  ? https({ cert: await readFile(values.cert), key: await readFile(values.key) }, handle)
  : http(handle);
server.listen(port, values.host, () => {
  const url = (values.cert ? "https" : "http") + "://" + values.host + ":" + port;
  console.log("Synthetic preview: " + url + "/");
  console.log("Income setup: " + url + "/?setup");
});
