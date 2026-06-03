import "server-only";
import {
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
  type InitializedHmacHttpAuth,
  type InitializedHmacMessageAuth,
} from "@naskot/node-hmac-auth";
import { createClient, type RedisClientType } from "redis";

/**
 * Process-singleton HMAC runtime for app_e (Next.js 15 / App Router /
 * Server Actions). The `globalThis` cache survives HMR reloads in dev.
 *
 * App E acts as a TARGET (receives propagated credentials from api_a
 * via the management lib) AND as a CALLER (signs outbound requests to
 * api_a / api_b / api_c / app_d using the propagated
 * `client_consumer_e` credential).
 */
const GLOBAL_KEY = Symbol.for("@mgmt-poc/app_e/hmac-auth-service");

type Built = { auth: InitializedHmacHttpAuth; messageAuth: InitializedHmacMessageAuth; redis: RedisClientType };

type Cached = {
  auth: InitializedHmacHttpAuth;
  messageAuth: InitializedHmacMessageAuth;
  redis: RedisClientType;
  promise: Promise<Built> | null;
};

function env(name: string, fallback: string) {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
}

async function build(): Promise<Built> {
  const redis: RedisClientType = createClient({ url: env("REDIS_URL", "redis://redis_e:6379") });
  redis.on("error", (error) => console.error("[app_e] redis error", error));
  await redis.connect();
  const redisLike = redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"];
  const namespace = env("HMAC_NAMESPACE", "app_e");
  const secretToken = env("HMAC_SECRET_TOKEN", "token_epsilon_E");
  const messageAuth = initializeHmacMessageAuth({ redis: redisLike, namespace, secretToken });
  const auth = initializeHmacHttpAuth({
    redis: redisLike,
    namespace,
    secretToken,
    internalManagementRoute: env("HMAC_INTERNAL_MANAGEMENT_ROUTE", "/api/internal/hmac"),
    messageAuth,
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

export const config = {
  serviceName: () => env("SERVICE_NAME", "app_e_nextjs"),
  signingClientId: () => env("SIGNING_CLIENT_ID", "client_consumer_e"),
  peers: () => ({
    api_a: env("PEER_API_A", "http://api_a:3000"),
    api_b: env("PEER_API_B", "http://api_b:3000"),
    api_c: env("PEER_API_C", "http://api_c:3000"),
    app_d: env("PEER_APP_D", "http://app_d:3000"),
  }),
};
