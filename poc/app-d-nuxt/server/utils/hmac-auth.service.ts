import { initializeHmacHttpAuth, type InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import { createClient, type RedisClientType } from "redis";

/**
 * Process-singleton wrapping `@naskot/node-hmac-auth` v1.3.0 for app_d.
 * Nitro can reload server modules under HMR; the `globalThis` cache
 * below ensures every Nitro plugin / middleware / route share the same
 * Redis connection and auth instance.
 *
 * App D is a TARGET of api_a's propagation pipeline AND a CALLER that
 * signs outbound requests to api_a / api_b / api_c / app_e using the
 * propagated `client_consumer_d` credential.
 */

const GLOBAL_KEY = Symbol.for("@mgmt-poc/app_d/hmac-auth-service");

type Cached = {
  auth: InitializedHmacHttpAuth;
  redis: RedisClientType;
  promise: Promise<{ auth: InitializedHmacHttpAuth; redis: RedisClientType }> | null;
};

async function build() {
  const config = useRuntimeConfig();
  const redis: RedisClientType = createClient({ url: config.redisUrl as string });
  redis.on("error", (error) => console.error("[app_d] redis error", error));
  await redis.connect();
  const auth = initializeHmacHttpAuth({
    redis: redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"],
    namespace: config.hmacNamespace as string,
    secretToken: config.hmacSecretToken as string,
    internalManagementRoute: config.hmacInternalManagementRoute as string,
    requireBootstrapClientId: config.hmacPropagationKey as string,
  });
  return { auth, redis };
}

export async function getHmacAuthService() {
  const slot = ((globalThis as Record<symbol, unknown>)[GLOBAL_KEY] ??= {
    auth: undefined,
    redis: undefined,
    promise: null,
  }) as Cached;
  if (slot.auth) return slot;
  if (!slot.promise) slot.promise = build();
  const built = await slot.promise;
  slot.auth = built.auth;
  slot.redis = built.redis;
  return slot;
}

export function resolvePeerUrl(peer: string) {
  const config = useRuntimeConfig();
  if (peer === "api_a") return config.peerApiA as string;
  if (peer === "api_b") return config.peerApiB as string;
  if (peer === "api_c") return config.peerApiC as string;
  if (peer === "app_e") return config.peerAppE as string;
  return null;
}
