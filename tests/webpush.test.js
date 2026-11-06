/* Phone and computer notifications: encryption, signing and grouping (supabase/functions/send-reminders). */
import { test } from "node:test";
import assert from "node:assert/strict";
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
  const devices = [{ id: 1, user_id: "ana" }, { id: 2, user_id: "ana" }, { id: 3, user_id: "ben" }, { id: 4, user_id: "cat" }];
  const calls = [];
  const send = async (d, msg) => { calls.push([d.id, msg.title]); return d.id === 2 ? { ok: false, gone: true } : { ok: true }; };
  const r = await deliver(pushes, devices, { send });
  assert.deepEqual(calls, [[1, "2 new reminders"], [2, "2 new reminders"], [3, "B1"]], "Cat has no new reminders: nothing sent");
  assert.deepEqual(r, { sent: [1, 3], gone: [2], failed: 0 });
});
