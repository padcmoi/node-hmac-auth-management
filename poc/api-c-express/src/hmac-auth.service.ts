import {
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
  type InitializedHmacHttpAuth,
  type InitializedHmacMessageAuth,
} from "@naskot/node-hmac-auth";
import { createClient, type RedisClientType } from "redis";

/**
 * Factory-pattern equivalent of api_a / api_b's NestJS HmacAuthService
 * for the Express variant. Express has no DI container, so we build the
 * initialized auth instance once and return a small object exposing the
 * surface the rest of the app needs.
 */
export type HmacAuthService = {
  readonly auth: InitializedHmacHttpAuth;
  readonly messageAuth: InitializedHmacMessageAuth;
  readonly redis: RedisClientType;
  listClientIds: () => Promise<string[]>;
};

export async function buildHmacAuthService(): Promise<HmacAuthService> {
  const redis: RedisClientType = createClient({ url: process.env.REDIS_URL ?? "redis://redis_c:6379" });
  redis.on("error", (error) => console.error("[api_c] redis error", error));
  await redis.connect();
  const redisLike = redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"];
  const namespace = process.env.HMAC_NAMESPACE ?? "api_c";
  const secretToken = process.env.HMAC_SECRET_TOKEN ?? "token_gamma_C";
  const messageAuth = initializeHmacMessageAuth({ redis: redisLike, namespace, secretToken });
  const auth = initializeHmacHttpAuth({
    redis: redisLike,
    namespace,
    secretToken,
    internalManagementRoute: process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac",
    messageAuth,
  });
  return {
    auth,
    messageAuth,
    redis,
    listClientIds: () => auth.clients.listClientIds(),
  };
}
