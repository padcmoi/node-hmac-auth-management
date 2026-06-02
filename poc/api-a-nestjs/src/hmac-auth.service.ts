import { Injectable } from "@nestjs/common";
import { initializeHmacHttpAuth, type InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import { createClient, type RedisClientType } from "redis";

/**
 * NestJS injectable wrapping `@naskot/node-hmac-auth` v1.3.0 for api_a.
 *
 * Boot sequence (run by the AppModule's useFactory provider):
 *   1. Open the Redis connection.
 *   2. Initialize the upstream HTTP auth with `requireBootstrapClientId`
 *      enabled (F2): until the propagation key is stored locally, every
 *      signed business request is refused with BOOTSTRAP_LOCKED.
 *
 * The instance exposes the upstream surface via `auth` so controllers
 * and middlewares can reach `clients`, `verifyHttpRequest`, and
 * `createInternalManagementMiddleware` without re-importing the
 * upstream barrel.
 */
@Injectable()
export class HmacAuthService {
  readonly auth: InitializedHmacHttpAuth;
  readonly redis: RedisClientType;

  constructor(auth: InitializedHmacHttpAuth, redis: RedisClientType) {
    this.auth = auth;
    this.redis = redis;
  }

  static async build() {
    const redis: RedisClientType = createClient({ url: process.env.REDIS_URL ?? "redis://redis_a:6379" });
    redis.on("error", (error) => {
      console.error("[api_a] redis error", error);
    });
    await redis.connect();
    // The upstream lib expects a `RedisLikeClient` structural type. The
    // node-redis v5 `RedisClientType` is structurally compatible at
    // runtime but tsc cannot infer the equivalence (overloads on hGet,
    // set, etc.). We cast through `unknown` to silence the noise; the
    // runtime call path is exercised by the lib's own vitest suite.
    const auth = initializeHmacHttpAuth({
      redis: redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"],
      namespace: process.env.HMAC_NAMESPACE ?? "api_a",
      secretToken: process.env.HMAC_SECRET_TOKEN ?? "token_alpha_A",
      internalManagementRoute: process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac",
      requireBootstrapClientId: process.env.HMAC_PROPAGATION_KEY ?? "self_propagation_signer",
    });
    return new HmacAuthService(auth, redis);
  }

  listClientIds() {
    return this.auth.clients.listClientIds();
  }
}
