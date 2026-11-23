/* Phone and computer notifications: encryption, signing and grouping (supabase/functions/send-reminders). */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ENDPOINT_SYNTAX, PROVIDER_SYNTAX, pushEndpoint } from "../supabase/functions/send-reminders/push-policy.js";
import { sendBatch } from "../supabase/functions/send-reminders/delivery.js";
import { encrypt, vapidHeader, sendPush, publicKeyFromJwk, b64u } from "../supabase/functions/send-reminders/webpush.js";
import { notificationFor, deliver } from "../supabase/functions/send-reminders/run.js";

const subtle = globalThis.crypto.subtle;
const newKey = async () => subtle.exportKey("jwk", (await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])).privateKey);

test("encryption matches the worked example in the web-push standard (RFC 8291) byte for byte", async () => {
  const asPub = b64u.decode("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8");
  const privateKey = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: b64u.encode(asPub.slice(1, 33)), y: b64u.encode(asPub.slice(33)), d: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw" },
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = await subtle.importKey("raw", asPub, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const out = await encrypt("When I grow up, I want to be a watermelon",
    { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" },
    { asKeys: { privateKey, publicKey }, salt: b64u.decode("DGv6ra1nlYgDCS1FRnbzlw") });
  assert.equal(b64u.encode(out), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
});

test("each message is locked differently (fresh keys and salt every time)", async () => {
  const sub = { p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  assert.notEqual(b64u.encode(await encrypt("same", sub)), b64u.encode(await encrypt("same", sub)));
  await assert.rejects(encrypt("x", { p256dh: "AAAA", auth: "BTBZMqHH6r4Tts7J_aSIgg" }), /keys look wrong/);
});

test("the VAPID signature is valid, for the push service's address, and expires in 12 hours", async () => {
  const jwk = await newKey(), now = Date.UTC(2026, 10, 6, 19, 30);
  const h = await vapidHeader("https://fcm.googleapis.com/fcm/send/abc123", jwk, "https://jayjett.github.io/my-budget/", now);
  const [, t, k] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, b64u.encode(publicKeyFromJwk(jwk)));
  const [hd, cl, sig] = t.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(b64u.decode(hd))), { typ: "JWT", alg: "ES256" });
  const claims = JSON.parse(new TextDecoder().decode(b64u.decode(cl)));
  assert.deepEqual(claims, { aud: "https://fcm.googleapis.com", exp: now / 1000 + 43200, sub: "https://jayjett.github.io/my-budget/" });
  const pub = await subtle.importKey("raw", b64u.decode(k), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  assert.equal(await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64u.decode(sig), new TextEncoder().encode(`${hd}.${cl}`)), true);
});

test("sending: the right headers; 201 is delivered, 404/410 mean the device has gone", async () => {
  const jwk = await newKey(), sub = { endpoint: "https://web.push.apple.com/abc", p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", auth: "BTBZMqHH6r4Tts7J_aSIgg" };
  let seen;
  const fetchFn = status => async (url, init) => { seen = { url, init }; return { status }; };
  assert.deepEqual(await sendPush(sub, { title: "Hi" }, { jwk, subject: "https://x/", fetchFn: fetchFn(201) }), { ok: true, gone: false, status: 201 });
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.init.headers["Content-Encoding"], "aes128gcm");
  assert.equal(seen.init.headers.TTL, "86400");
  assert.match(seen.init.headers.Authorization, /^vapid t=.+, k=/);
  assert.ok(seen.init.body.length > 100, "an encrypted body");
  assert.equal((await sendPush(sub, {}, { jwk, subject: "x", fetchFn: fetchFn(410) })).gone, true);
  assert.equal((await sendPush(sub, {}, { jwk, subject: "x", fetchFn: fetchFn(404) })).gone, true);
  assert.deepEqual(await sendPush(sub, {}, { jwk, subject: "x", fetchFn: fetchFn(500) }), { ok: false, gone: false, status: 500 });
});

test("one notification per person: a single reminder as it is, several as 'N new reminders'", () => {
  assert.deepEqual(notificationFor([{ title: "Car rego is behind by $50", body: "Put aside $10 a fortnight.", tab: "spending" }]),
    { title: "Car rego is behind by $50", body: "Put aside $10 a fortnight.", url: "./#joint-spending", tag: "mb-reminders" });
  const n = notificationFor([{ title: "A", tab: "goals" }, { title: "B", tab: "budget" }, { title: "C", tab: "networth" }]);
  assert.equal(n.title, "3 new reminders"); assert.equal(n.body, "A · B · C"); assert.equal(n.url, "./#reminders");
});

test("delivery: each person's devices get their own notification; gone devices are reported", async () => {
  const pushes = [{ user_id: "ana", title: "A1" }, { user_id: "ana", title: "A2" }, { user_id: "ben", title: "B1" }];
  const devices = [{ id: 1, user_id: "ana" }, { id: 2, user_id: "ana" }, { id: 3, user_id: "ben" }, { id: 4, user_id: "cat" }].map(d => ({ ...d, endpoint: "https://fcm.googleapis.com/wp/d" + d.id }));
  const calls = [];
  const send = async (d, msg) => { calls.push([d.id, msg.title]); return d.id === 2 ? { ok: false, gone: true } : { ok: true }; };
  const r = await deliver(pushes, devices, { send });
  assert.deepEqual(calls, [[1, "2 new reminders"], [2, "2 new reminders"], [3, "B1"]], "Cat has no new reminders: nothing sent");
  assert.deepEqual(r, { sent: [1, 3], gone: [2], failed: 0, suppressed: 0 });
});

const point = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const auth = "BTBZMqHH6r4Tts7J_aSIgg";
const synthetic = endpoint => ({ endpoint, p256dh: point, auth });
const APPROVED = [
  "https://web.push.apple.com/synthetic-dev",
  "https://fcm.googleapis.com/wp/synthetic-dev",
  "https://fcm.googleapis.com/fcm/send/synthetic-dev",
  "https://updates.push.services.mozilla.com/wpush/v1/synthetic-dev",
  "https://updates.push.services.mozilla.com/wpush/v2/synthetic-dev",
  "https://wns2-test.notify.windows.com/?token=synthetic%2Fvalue%3D",
];

test("only reviewed provider routes resolve to a canonical HTTPS destination", () => {
  for (const ep of APPROVED) assert.equal(pushEndpoint(ep), ep);
  assert.equal(pushEndpoint("https://FCM.googleapis.com:443/wp/synthetic-dev"), APPROVED[1]);
  assert.equal(pushEndpoint("https://wns2-test.notify.windows.com/?token=synthetic%2fvalue%3d"), APPROVED.at(-1));
  for (const ep of [
    "https://unapproved.example/test",
    "https://192.0.2.1/test",
    "https://localhost/test",
    "https://fcm.googleapis.com.example.test/wp/synthetic-dev",
    "https://fcm.googleapis.com/another-service",
    "http://fcm.googleapis.com/wp/synthetic-dev",
    "https://web.push.apple.com:444/synthetic-dev",
    "https://demo:pass@web.push.apple.com/synthetic-dev",
    "https://web.push.apple.com/./synthetic-dev",
    "https://web.push.apple.com/synthetic-dev#part",
    "https://web.push.apple.com/" + "a".repeat(1000),
  ]) assert.equal(pushEndpoint(ep), null);
});

test("the registration migration and Edge use the same provider expressions", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261123022923_push_destination_security.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("$endpoint$" + ENDPOINT_SYNTAX + "$endpoint$"));
  assert.ok(sql.includes("$provider$" + PROVIDER_SYNTAX + "$provider$"));
});

test("unapproved endpoints and malformed subscription keys never reach transport", async () => {
  const jwk = await newKey();
  let fetches = 0;
  const opts = { jwk, subject: "https://example.test/", fetchFn: async () => { fetches++; return { status: 201 }; } };
  const bad = [
    synthetic("https://unapproved.example/test"),
    { ...synthetic(APPROVED[0]), p256dh: "BA" + "A".repeat(85) },
    { ...synthetic(APPROVED[0]), auth: auth.slice(0, -1) + "h" },
    { ...synthetic(APPROVED[0]), auth: auth + "AA" },
    { ...synthetic(APPROVED[0]), p256dh: "A".repeat(4096) },
  ];
  for (const s of bad) assert.equal((await sendPush(s, {}, opts)).suppressed, true);
  assert.equal(fetches, 0);
});

test("the transport rejects redirects and treats transient provider responses as failures", async () => {
  const jwk = await newKey(), sub = synthetic(APPROVED[1]);
  const status = async (result, redirected = false) => sendPush(sub, {}, {
    jwk, subject: "https://example.test/",
    fetchFn: async (url, init) => {
      assert.equal(url, sub.endpoint);
      assert.equal(init.redirect, "error");
      return { status: result, redirected };
    },
  });
  assert.deepEqual(await status(307), { ok: false, gone: false, status: 307 });
  assert.deepEqual(await status(410, true), { ok: false, gone: false, status: 410 });
  for (const code of [429, 500, 503]) assert.deepEqual(await status(code), { ok: false, gone: false, status: code });
});

test("network timeout aborts one request and never automatically resends", async () => {
  const jwk = await newKey();
  let calls = 0, aborted = false;
  const result = await sendPush(synthetic(APPROVED[0]), {}, {
    jwk, subject: "https://example.test/", timeoutMs: 1,
    fetchFn: (_url, { signal }) => new Promise((_accept, reject) => {
      calls++;
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("internal provider diagnostics")); }, { once: true });
    }),
  });
  assert.equal(aborted, true);
  assert.equal(calls, 1);
  assert.deepEqual(result, { ok: false, gone: false, status: null });
});

test("batch concurrency is bounded and aliases do not create extra sends", async () => {
  const calls = [], gates = [];
  let started;
  const filled = new Promise(resolve => { started = resolve; });
  const pending = sendBatch([
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, user_id: "one", endpoint: "https://fcm.googleapis.com/wp/device-" + i })),
    { id: 9, user_id: "one", endpoint: "https://fcm.googleapis.com/fcm/send/device-0" },
    { id: 10, user_id: "two", endpoint: "https://unapproved.example/device" },
  ], () => ({}), { send: d => {
    calls.push(d.id);
    if (calls.length <= 4) return new Promise(resolve => {
      gates.push(resolve);
      if (gates.length === 4) started();
    });
    return { ok: true };
  } });
  await filled;
  assert.deepEqual(calls, [0, 1, 2, 3]);
  for (const resolve of gates) resolve({ ok: true });
  assert.deepEqual(await pending, { sent: [0,1,2,3,4,5], gone: [], failed: 0, suppressed: 2 });
});
