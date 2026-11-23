import { pushEndpoint, pushEndpointKey } from "./push-policy.js";
import { sendPush } from "./webpush.js";

const MAX_PARALLEL = 4;
const BATCH_MS = 85000;

/** Run one bounded delivery pass. Only a direct, approved provider's gone
    response can enter the existing cleanup path. Suppressed rows stay put. */
export async function sendBatch(devices, messageFor, { jwk, subject, send = sendPush }) {
  const summaries = { sent: [], gone: [], failed: 0, suppressed: 0 };
  const groups = new Map();
  for (const d of devices || []) {
    const endpoint = pushEndpoint(d.endpoint);
    if (!endpoint) { summaries.suppressed++; continue; }
    const key = pushEndpointKey(endpoint);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...d, endpoint });
  }
  const tasks = [];
  for (const group of groups.values()) {
    if (group.some(d => d.user_id !== group[0].user_id)) { summaries.suppressed += group.length; continue; }
    const message = messageFor(group[0]);
    if (!message) continue;
    summaries.suppressed += group.length - 1;
    tasks.push([group[0], message]);
  }

  let next = 0;
  const deadline = Date.now() + BATCH_MS;
  const results = [];
  async function work() {
    while (next < tasks.length) {
      const i = next++;
      const [device, message] = tasks[i];
      const remaining = deadline - Date.now();
      if (remaining <= 0) { results[i] = {}; continue; }
      try { results[i] = await send(device, message, { jwk, subject, timeoutMs: Math.min(8000, remaining) }); }
      catch (_) { results[i] = {}; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, tasks.length) }, work));
  for (const [i, result] of results.entries()) {
    if (result.ok) summaries.sent.push(tasks[i][0].id);
    else if (result.gone) summaries.gone.push(tasks[i][0].id);
    else if (result.suppressed) summaries.suppressed++;
    else summaries.failed++;
  }
  return summaries;
}
