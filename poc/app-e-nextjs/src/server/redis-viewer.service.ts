import "server-only";
import { createClient, type RedisClientType } from "redis";

/**
 * Read-only Redis inspector for the POC's /redis page.
 *
 * Opens one client per peer Redis (same Docker compose network, no HMAC
 * needed: pure Redis reads). Caches each connection on a globalThis slot
 * so module reloads and Server Action invocations reuse the same socket.
 *
 * Keys filtered out: anything matching `*:nonce:*` (replay protection
 * entries with TTL; the user explicitly does not want to see them).
 */
export type PeerName = "api_a" | "api_b" | "api_c" | "app_d" | "app_e";

export interface RedisEntry {
  key: string;
  type: string;
  value: unknown;
  ttlSeconds: number | null;
}

export interface RedisDump {
  peer: PeerName;
  url: string;
  namespace: string;
  ok: boolean;
  error?: string;
  entries: RedisEntry[];
  scannedKeys: number;
  skippedNonces: number;
  fetchedAt: string;
}

const PEERS: ReadonlyArray<PeerName> = ["api_a", "api_b", "api_c", "app_d", "app_e"];

function envOr(name: string, fallback: string) {
  const v = process.env[name];
  return v && v.trim() ? v : fallback;
}

function urlFor(peer: PeerName): string {
  const map: Record<PeerName, string> = {
    api_a: envOr("REDIS_URL_API_A", "redis://redis_a:6379"),
    api_b: envOr("REDIS_URL_API_B", "redis://redis_b:6379"),
    api_c: envOr("REDIS_URL_API_C", "redis://redis_c:6379"),
    app_d: envOr("REDIS_URL_APP_D", "redis://redis_d:6379"),
    app_e: envOr("REDIS_URL_APP_E", "redis://redis_e:6379"),
  };
  return map[peer];
}

function namespaceFor(peer: PeerName): string {
  const map: Record<PeerName, string> = {
    api_a: envOr("PEER_NS_API_A", "api_a"),
    api_b: envOr("PEER_NS_API_B", "api_b"),
    api_c: envOr("PEER_NS_API_C", "api_c"),
    app_d: envOr("PEER_NS_APP_D", "app_d"),
    app_e: envOr("PEER_NS_APP_E", "app_e"),
  };
  return map[peer];
}

const GLOBAL_KEY = Symbol.for("@mgmt-poc/app_e/redis-viewer");
type Cache = { clients: Map<PeerName, RedisClientType>; connecting: Map<PeerName, Promise<RedisClientType>> };

function cache(): Cache {
  const slot = ((globalThis as Record<symbol, unknown>)[GLOBAL_KEY] ??= {
    clients: new Map(),
    connecting: new Map(),
  }) as Cache;
  return slot;
}

async function clientFor(peer: PeerName): Promise<RedisClientType> {
  const c = cache();
  const existing = c.clients.get(peer);
  if (existing && existing.isOpen) return existing;
  const inflight = c.connecting.get(peer);
  if (inflight) return inflight;
  const promise = (async () => {
    const client: RedisClientType = createClient({ url: urlFor(peer) });
    client.on("error", (error) => console.error(`[redis-viewer:${peer}]`, error));
    await client.connect();
    c.clients.set(peer, client);
    c.connecting.delete(peer);
    return client;
  })();
  c.connecting.set(peer, promise);
  return promise;
}

async function readEntry(client: RedisClientType, key: string): Promise<RedisEntry> {
  const type = await client.type(key);
  const ttl = await client.ttl(key);
  const ttlSeconds = ttl >= 0 ? ttl : null;
  let value: unknown;
  switch (type) {
    case "string":
      value = await client.get(key);
      break;
    case "hash": {
      // node-redis returns a null-prototype object; spread into a plain
      // object so Next can serialize it across the Server -> Client boundary.
      const raw = await client.hGetAll(key);
      value = { ...raw };
      break;
    }
    case "set":
      value = [...(await client.sMembers(key))];
      break;
    case "zset":
      value = [...(await client.zRangeWithScores(key, 0, -1))];
      break;
    case "list":
      value = [...(await client.lRange(key, 0, -1))];
      break;
    case "stream":
      value = "(stream, not dumped)";
      break;
    default:
      value = `(unsupported type: ${type})`;
  }
  return { key, type, value, ttlSeconds };
}

export async function dumpPeer(peer: PeerName): Promise<RedisDump> {
  const url = urlFor(peer);
  const namespace = namespaceFor(peer);
  const fetchedAt = new Date().toISOString();
  try {
    const client = await clientFor(peer);
    const entries: RedisEntry[] = [];
    let scannedKeys = 0;
    let skippedNonces = 0;
    for await (const key of client.scanIterator({ MATCH: "*", COUNT: 200 })) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        scannedKeys += 1;
        if (k.includes(":nonce:") || k.endsWith(":nonce")) {
          skippedNonces += 1;
          continue;
        }
        entries.push(await readEntry(client, k));
      }
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    return { peer, url, namespace, ok: true, entries, scannedKeys, skippedNonces, fetchedAt };
  } catch (error) {
    return {
      peer,
      url,
      namespace,
      ok: false,
      error: (error as Error).message,
      entries: [],
      scannedKeys: 0,
      skippedNonces: 0,
      fetchedAt,
    };
  }
}

export async function dumpAll(): Promise<RedisDump[]> {
  return Promise.all(PEERS.map((p) => dumpPeer(p)));
}

export const peerNames = PEERS;
