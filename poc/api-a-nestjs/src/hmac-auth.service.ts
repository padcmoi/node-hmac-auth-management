import { Injectable } from "@nestjs/common";
import {
  initializeHmacHttpAuth,
  initializeHmacMessageAuth,
  type InitializedHmacHttpAuth,
  type InitializedHmacMessageAuth,
} from "@naskot/node-hmac-auth";
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
  readonly messageAuth: InitializedHmacMessageAuth;
  readonly redis: RedisClientType;

  constructor(auth: InitializedHmacHttpAuth, messageAuth: InitializedHmacMessageAuth, redis: RedisClientType) {
    this.auth = auth;
    this.messageAuth = messageAuth;
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
    const redisLike = redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"];
    const namespace = process.env.HMAC_NAMESPACE ?? "api_a";
    const secretToken = process.env.HMAC_SECRET_TOKEN ?? "token_alpha_A";
    // Message track shares the same Redis + namespace; the upstream lib
    // segregates the message-credential keys with its own internal prefixes
    // so the HTTP and message stores never collide. We initialize it BEFORE
    // the HTTP auth so we can bridge it into the HTTP runtime: bridging is
    // mandatory for handleInternalManagementRequest to route `kind: "message"`
    // payloads to the message store on the target side.
    const messageAuth = initializeHmacMessageAuth({
      redis: redisLike,
      namespace,
      secretToken,
    });
    const auth = initializeHmacHttpAuth({
      redis: redisLike,
      namespace,
      secretToken,
      internalManagementRoute: process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac",
      messageAuth,
    });
    return new HmacAuthService(auth, messageAuth, redis);
  }

  listClientIds() {
    return this.auth.clients.listClientIds();
  }
}
