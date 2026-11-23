/* Provider routes are the source for both Edge and the registration migration.
   Keep paths and query values opaque except for normalising documented aliases. */
const LABEL = "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
export const ENDPOINT_SYNTAX = "^https://([A-Za-z0-9.-]+)(?::443)?(/[A-Za-z0-9._~!$&()*+,;=:@%/?-]+)$";
export const ROUTES = [
  "fcm[.]googleapis[.]com/(wp|fcm/send)/[A-Za-z0-9._~:+-]+",
  "updates[.]push[.]services[.]mozilla[.]com/wpush/v[12]/[A-Za-z0-9._~-]+",
  LABEL + "[.]push[.]apple[.]com/[A-Za-z0-9._~/-]+",
  LABEL + "[.]notify[.]windows[.]com/([A-Za-z0-9._~/-]*[?]token=([A-Za-z0-9._~-]|%2[Ff]|%2[Bb]|%3[Dd])+)",
];
export const PROVIDER_SYNTAX = "^(" + ROUTES.join("|") + ")$";
const endpointSyntax = new RegExp(ENDPOINT_SYNTAX);
const providers = new RegExp(PROVIDER_SYNTAX);

export function pushEndpoint(value) {
  if (typeof value !== "string" || value.length >= 1000) return null;
  const match = endpointSyntax.exec(value);
  if (!match || match[0] !== value) return null;
  const host = match[1].toLowerCase();
  const route = match[2].replace(/%[0-9a-f]{2}/gi, s => s.toUpperCase());
  if (!providers.test(host + route) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(route.split("?")[0])) return null;
  const endpoint = "https://" + host + route;
  const parsed = new URL(endpoint);
  return parsed.href === endpoint ? endpoint : null;
}

// The old Chromium path reaches the same FCM subscription. Keep the wire URL
// from the browser, but use one ownership and deduplication key for both paths.
export function pushEndpointKey(endpoint) {
  return endpoint.replace("https://fcm.googleapis.com/fcm/send/", "https://fcm.googleapis.com/wp/");
}
