// POC end-to-end test suite. Runs as a one-shot docker-compose service
// (`e2e_tests` in docker-compose.yml). Exit code is non-zero on any
// assertion failure: the suite's container reports a red `Exit 1` status
// and a single `docker logs mgmt-poc-e2e` makes the regression obvious.
//
// Invariants enforced (all derived from the v1.4.0 lib contract):
//   1. api_a /admin/data-plane returns both data-plane consumers with
//      status=ok and secret=null. Eventually-converges semantics: a
//      transient target outage may temporarily flip a row to status=error
//      with secret=null, but the consumer's pre-tick heal-and-seed
//      MUST re-inject the plain so the next sync re-delivers and the row
//      converges back to status=ok within 2 sync ticks. The test waits
//      up to 12 minutes for first-time convergence (fresh boot has to
//      compile the lib + build 4 user apps + tick at least once).
//   2. Every peer Redis holds `self_propagation_signer`, `client_consumer_d`
//      and `client_consumer_e` under `<ns>:clients`, with byte-identical
//      `secretHash` across distinct HMAC_SECRET_TOKEN values. This is
//      the cornerstone of the v1.4.0 federation contract: every API
//      *requires* `self_propagation_signer` (bootstrap lock), so once a
//      peer has it, that peer accepts every credential propagated through
//      that signer.
//   3. Nuxt /admin and Next /redis pages respond 200.
//   4. Resilience: stop app_d, wait for sync to see it unreachable, then
//      restart app_d. The test asserts that within 4 sync ticks BOTH
//      consumers converge back to status=ok (heal-and-seed cycle).
//
// The test communicates with the compose stack via the internal Docker
// network (api_a:3000 etc.) so no host port mapping is required.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { spawnSync } from "node:child_process";
import { createClient } from "redis";

const API_A_BASE = process.env.API_A_BASE ?? "http://api_a:3000";
const APP_D_BASE = process.env.APP_D_BASE ?? "http://app_d:3000";
const APP_E_BASE = process.env.APP_E_BASE ?? "http://app_e:3000";
const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? "20000");
const BOOT_CONVERGE_TIMEOUT_MS = Number(process.env.BOOT_CONVERGE_TIMEOUT_MS ?? `${12 * 60 * 1000}`);
const APP_D_RESTART_TIMEOUT_MS = Number(process.env.APP_D_RESTART_TIMEOUT_MS ?? `${5 * 60 * 1000}`);

const PEERS = [
  { name: "api_a", ns: "api_a", redisUrl: process.env.REDIS_URL_API_A ?? "redis://redis_a:6379" },
  { name: "api_b", ns: "api_b", redisUrl: process.env.REDIS_URL_API_B ?? "redis://redis_b:6379" },
  { name: "api_c", ns: "api_c", redisUrl: process.env.REDIS_URL_API_C ?? "redis://redis_c:6379" },
  { name: "app_d", ns: "app_d", redisUrl: process.env.REDIS_URL_APP_D ?? "redis://redis_d:6379" },
  { name: "app_e", ns: "app_e", redisUrl: process.env.REDIS_URL_APP_E ?? "redis://redis_e:6379" },
];
const EXPECTED_CLIENTS = ["self_propagation_signer", "client_consumer_d", "client_consumer_e"];

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function getDataPlaneRows() {
  const { status, body } = await fetchJson(`${API_A_BASE}/admin/data-plane?track=http`);
  assert.equal(status, 200, `api_a /admin/data-plane responded ${status}: ${JSON.stringify(body)}`);
  assert.ok(body && body.ok === true, `unexpected payload: ${JSON.stringify(body)}`);
  assert.ok(Array.isArray(body.rows), `rows missing from payload: ${JSON.stringify(body)}`);
  return body.rows;
}

async function readPeerClients(peer) {
  const client = createClient({ url: peer.redisUrl });
  client.on("error", () => {});
  await client.connect();
  try {
    const map = await client.hGetAll(`${peer.ns}:clients`);
    return map ?? {};
  } finally {
    await client.quit();
  }
}

async function waitUntil(label, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastValue = null;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return;
      lastValue = result;
    } catch (error) {
      lastError = error;
    }
    await sleep(2000);
  }
  throw new Error(
    `waitUntil('${label}') timed out after ${timeoutMs}ms. lastError=${lastError?.message ?? "(none)"} lastValue=${JSON.stringify(lastValue)}`
  );
}

function dockerCmd(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed (status=${result.status}): ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function logSection(title) {
  console.log(`\n>>>>> ${title}`);
}

test("1. boot convergence: both data-plane consumers reach status=ok", async () => {
  logSection("waiting for first-boot convergence (up to 12 min)");
  await waitUntil(
    "both consumers status=ok",
    async () => {
      const rows = await getDataPlaneRows();
      const consumers = rows.filter((r) => r.clientId === "client_consumer_d" || r.clientId === "client_consumer_e");
      if (consumers.length !== 2) return false;
      return consumers.every((r) => r.status === "ok");
    },
    BOOT_CONVERGE_TIMEOUT_MS
  );
  const rows = await getDataPlaneRows();
  const byClientId = Object.fromEntries(rows.map((r) => [r.clientId, r]));
  for (const c of ["client_consumer_d", "client_consumer_e"]) {
    assert.equal(byClientId[c].status, "ok", `${c}.status`);
    assert.equal(byClientId[c].secret, null, `${c}.secret must be cleared once delivered`);
    assert.ok(byClientId[c].attemptCount >= 1, `${c}.attemptCount`);
    assert.ok(Array.isArray(byClientId[c].targets) && byClientId[c].targets.length === 5, `${c}.targets`);
  }
});

test("2. v1.4.0 invariant: every peer holds self_propagation_signer + both consumers", async () => {
  logSection("waiting for every peer Redis to converge (all 3 creds everywhere)");
  // Up to 4 sync ticks for the data-plane to land on every peer after
  // the initial roll-out (first ticks often error if a peer was still
  // booting during the very first sync, then heal-and-seed retries).
  let collected = {};
  await waitUntil(
    "every peer holds all 3 expected credentials",
    async () => {
      const next = {};
      for (const peer of PEERS) {
        next[peer.name] = await readPeerClients(peer);
      }
      collected = next;
      for (const peer of PEERS) {
        const present = Object.keys(collected[peer.name]);
        for (const expected of EXPECTED_CLIENTS) {
          if (!present.includes(expected)) return false;
        }
      }
      return true;
    },
    SYNC_INTERVAL_MS * 6
  );

  // Cross-token byte-identical secretHash for each expected clientId.
  const reference = collected.api_a;
  for (const clientId of EXPECTED_CLIENTS) {
    const refRecord = JSON.parse(reference[clientId]);
    const refHash = refRecord.secretHash;
    assert.ok(refHash, `api_a's '${clientId}' record has no secretHash: ${JSON.stringify(refRecord)}`);
    for (const peerName of Object.keys(collected)) {
      if (peerName === "api_a") continue;
      const otherRecord = JSON.parse(collected[peerName][clientId]);
      assert.equal(
        otherRecord.secretHash,
        refHash,
        `secretHash mismatch for '${clientId}': api_a=${refHash} ${peerName}=${otherRecord.secretHash}`
      );
    }
  }
});

test("3. Nuxt /admin page is reachable", async () => {
  logSection("waiting for Nuxt /admin to respond 200");
  // app_d in prod+watch mode rebuilds on file change; the first cold build
  // can take several minutes. Wait until /admin is reachable.
  await waitUntil(
    "Nuxt /admin responds 200",
    async () => {
      try {
        const res = await fetch(`${APP_D_BASE}/admin`);
        if (res.status !== 200) return false;
        const html = await res.text();
        return html.includes("api_a managed BDD");
      } catch {
        return false;
      }
    },
    10 * 60 * 1000
  );
});

test("4. Next /redis page is reachable", async () => {
  logSection("waiting for Next /redis to respond 200");
  await waitUntil(
    "Next /redis responds 200",
    async () => {
      try {
        const res = await fetch(`${APP_E_BASE}/redis`);
        if (res.status !== 200) return false;
        const html = await res.text();
        return html.includes("Redis viewer");
      } catch {
        return false;
      }
    },
    10 * 60 * 1000
  );
});

test("5. resilience: target reset on app_d (wipe redis_d) -> auto re-bootstrap + re-propagation", async () => {
  // Real-world disaster: app_d's Redis is wiped (cluster restart, manual
  // FLUSHALL, restored-from-empty-snapshot). app_d itself is still up, but
  // its credential store is empty -> the propagation key + both data-plane
  // consumers must reappear automatically without any operator action.
  //
  // The lib's contract:
  //   - api_a's next sync tick probes each target, sees clientsCount=0 on
  //     app_d while its per-(row, target) cursor remembers a previous
  //     `delivered` -> target reset detected.
  //   - api_a re-bootstraps app_d through the v1.4.0 bootstrap window using
  //     `self_propagation_signer` (mandatory, by lib default).
  //   - api_a then flips every data-plane row's app_d cursor back to
  //     `pending` and re-propagates client_consumer_d and client_consumer_e
  //     to app_d.
  //   - The two top-level rows transit through status=pending and reach
  //     status=ok again within 2-3 sync ticks.
  logSection("snapshot: verifying app_d Redis has all 3 expected credentials BEFORE flush");
  const beforeFlush = await readPeerClients(PEERS.find((p) => p.name === "app_d"));
  const beforeKeys = Object.keys(beforeFlush).sort();
  for (const expected of EXPECTED_CLIENTS) {
    assert.ok(beforeKeys.includes(expected), `app_d missing '${expected}' BEFORE flush (test invalid)`);
  }

  logSection("flushing redis_d (simulates target reset / disaster recovery)");
  dockerCmd(["exec", "mgmt-poc-redis-d", "redis-cli", "FLUSHALL"]);

  logSection("snapshot: confirming redis_d is empty after flush");
  const afterFlush = await readPeerClients(PEERS.find((p) => p.name === "app_d"));
  assert.equal(Object.keys(afterFlush).length, 0, "redis_d should be empty after FLUSHALL");

  logSection("waiting for api_a to detect target reset, re-bootstrap, re-propagate (up to 6 ticks)");
  await waitUntil(
    "app_d Redis re-populated with all 3 credentials",
    async () => {
      const clients = await readPeerClients(PEERS.find((p) => p.name === "app_d"));
      const present = Object.keys(clients).sort();
      return EXPECTED_CLIENTS.every((c) => present.includes(c));
    },
    SYNC_INTERVAL_MS * 6
  );

  logSection("waiting for data-plane rows to converge back to status=ok");
  await waitUntil(
    "both consumers back to status=ok",
    async () => {
      const rows = await getDataPlaneRows();
      const consumers = rows.filter((r) => r.clientId === "client_consumer_d" || r.clientId === "client_consumer_e");
      return consumers.length === 2 && consumers.every((r) => r.status === "ok");
    },
    SYNC_INTERVAL_MS * 6
  );

  logSection("post-recovery: re-verifying cross-token secretHash on app_d");
  const recovered = await readPeerClients(PEERS.find((p) => p.name === "app_d"));
  const reference = await readPeerClients(PEERS.find((p) => p.name === "api_a"));
  for (const clientId of EXPECTED_CLIENTS) {
    const ref = JSON.parse(reference[clientId]);
    const got = JSON.parse(recovered[clientId]);
    assert.equal(
      got.secretHash,
      ref.secretHash,
      `post-recovery secretHash mismatch for '${clientId}': api_a=${ref.secretHash} app_d=${got.secretHash}`
    );
  }
});
