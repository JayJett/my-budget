/* Sending a phone/computer notification ("web push"), using only the built-in Web Crypto API,
   so it runs the same in the Supabase function (Deno) and in the tests (Node). No outside library.

   Two standards are involved:
   - VAPID (RFC 8292): we sign a short note ("this is My Budget, valid for 12 hours") with our private key,
     so Apple's and Google's push services know the message really comes from this app.
   - Message encryption (RFC 8291, with RFC 8188 "aes128gcm"): the reminder is encrypted so only the
     receiving device can read it. Apple and Google just pass on a locked box.

   Keys:
   - VAPID_PRIVATE_KEY (an Edge Function secret, added by you in the Supabase dashboard): a JSON Web Key
     for an ECDSA P-256 key pair, made by tools/make-push-keys.html. It also contains the public half.
   - The matching public key goes in js/config.js (VAPID_PUBLIC_KEY), so browsers can subscribe. */

const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;

export const b64u = {
  encode(bytes) {
    let s = ""; const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  },
  decode(str) {
    const s = String(str).replace(/-/g, "+").replace(/_/g, "/"), pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
    const bin = atob(s + pad), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  },
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
async function hmac(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

/** The public key (65 bytes, as browsers want it) from a private JWK. */
export function publicKeyFromJwk(jwk) {
  return concat(new Uint8Array([4]), b64u.decode(jwk.x), b64u.decode(jwk.y));
}

/** Encrypt a message for one subscription (RFC 8291). `opts` lets the tests fix the random parts. */
export async function encrypt(payload, sub, opts = {}) {
  const uaPublic = b64u.decode(sub.p256dh), authSecret = b64u.decode(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("This device's subscription keys look wrong");
  // A fresh, one-off key pair for this message
  const as = opts.asKeys || await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await subtle.exportKey("raw", as.publicKey));
  const uaKey = await subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const salt = opts.salt || globalThis.crypto.getRandomValues(new Uint8Array(16));
  // Key derivation (HKDF, written out step by step)
  const prkKey = await hmac(authSecret, ecdhSecret);
  const ikm = (await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  // One record: the message, then a 0x02 "last record" marker
  const plain = concat(typeof payload === "string" ? enc.encode(payload) : payload, new Uint8Array([2]));
  const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plain));
  const rs = new Uint8Array([0, 0, 0x10, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** The VAPID "Authorization" header for a push service (RFC 8292). */
export async function vapidHeader(endpoint, jwk, subject, now = Date.now()) {
  const aud = new URL(endpoint).origin;
  const header = b64u.encode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u.encode(enc.encode(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64u.encode(sig)}, k=${b64u.encode(publicKeyFromJwk(jwk))}`;
}

/** Send one notification. Returns { ok, gone, status }: `gone` means the device has unsubscribed
    (or the app was removed), so its subscription should be forgotten. */
export async function sendPush(sub, message, { jwk, subject, fetchFn = fetch, ttl = 86400 }) {
  const body = await encrypt(JSON.stringify(message), sub);
  const res = await fetchFn(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, jwk, subject),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "normal",
    },
    body,
  });
  return { ok: res.status >= 200 && res.status < 300, gone: res.status === 404 || res.status === 410, status: res.status };
}
