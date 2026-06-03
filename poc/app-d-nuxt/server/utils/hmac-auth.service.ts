import {
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
  type InitializedHmacHttpAuth,
  type InitializedHmacMessageAuth,
} from "@naskot/node-hmac-auth";
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

type Built = { auth: InitializedHmacHttpAuth; messageAuth: InitializedHmacMessageAuth; redis: RedisClientType };

type Cached = {
  auth: InitializedHmacHttpAuth;
  messageAuth: InitializedHmacMessageAuth;
  redis: RedisClientType;
  promise: Promise<Built> | null;
};

async function build(): Promise<Built> {
  const config = useRuntimeConfig();
  const redis: RedisClientType = createClient({ url: config.redisUrl as string });
  redis.on("error", (error) => console.error("[app_d] redis error", error));
  await redis.connect();
  const redisLike = redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"];
  const namespace = config.hmacNamespace as string;
  const secretToken = config.hmacSecretToken as string;
  // Bridge message auth into HTTP init so app_d accepts propagated
  // message-track credentials on its internal management route.
  const messageAuth = initializeHmacMessageAuth({ redis: redisLike, namespace, secretToken });
  const auth = initializeHmacHttpAuth({
    redis: redisLike,
    namespace,
    secretToken,
    internalManagementRoute: config.hmacInternalManagementRoute as string,
    messageAuth,
    // requireBootstrapClientId omitted -> defaults to self_propagation_signer
  });
  return { auth, messageAuth, redis };
}

export async function getHmacAuthService() {
  const slot = ((globalThis as Record<symbol, unknown>)[GLOBAL_KEY] ??= {
    auth: undefined,
    messageAuth: undefined,
    redis: undefined,
    promise: null,
  }) as Cached;
  if (slot.auth) return slot;
  if (!slot.promise) slot.promise = build();
  const built = await slot.promise;
  slot.auth = built.auth;
  slot.messageAuth = built.messageAuth;
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
