import { app } from "./ctx.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config.js";

const sheets = new WeakMap();

/** The sheet body is replaced on every open, including when the dialog is already open. */
export function bindSettingsSheet(body) {
  const { store, household, role, meId } = app;
  const dialog = body.closest("dialog");
  const current = () => !!store?.isActive() && store === app.store && meId === app.meId &&
    household === app.household && role === app.role && dialog.open && body.isConnected;
  const scope = {
    body, store, household, userId: meId, role, current,
    request: makeRequest => store.scopedRequest(makeRequest, current),
    rpc: (name, params) => store.scopedRequest(
      sb => sb.rpc(name, { ...params, p_household: household.id }), current),
  };
  sheets.set(body, scope);
  return scope;
}

export function settingsScope(element) {
  const scope = sheets.get(element.closest(".ind-settings"));
  return scope?.current() ? scope : null;
}


/** Storage has no per-request setter. Give each call a client with a pinned token. */
export function settingsStorage(token) {
  return window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
    accessToken: async () => token,
  }).storage;
}
