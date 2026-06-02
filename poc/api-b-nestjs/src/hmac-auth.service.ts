import { Injectable } from "@nestjs/common";
import { initializeHmacHttpAuth, type InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import { createClient, type RedisClientType } from "redis";

/**
 * NestJS injectable wrapping `@naskot/node-hmac-auth` v1.3.0 for api_b.
 * api_b is a TARGET in the POC: it accepts propagated credentials from
 * api_a on its `/api/internal/hmac` route, exposes a signed business
 * route at `/secure/business`, and a signed read-only endpoint at
 * `/secure/credentials/local` for the Nuxt/Next UIs to display its
 * Redis contents.
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
    const redis: RedisClientType = createClient({ url: process.env.REDIS_URL ?? "redis://redis_b:6379" });
    redis.on("error", (error) => {
      console.error("[api_b] redis error", error);
    });
    await redis.connect();
    const auth = initializeHmacHttpAuth({
      redis: redis as unknown as Parameters<typeof initializeHmacHttpAuth>[0]["redis"],
      namespace: process.env.HMAC_NAMESPACE ?? "api_b",
      secretToken: process.env.HMAC_SECRET_TOKEN ?? "token_beta_B",
      internalManagementRoute: process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac",
      requireBootstrapClientId: process.env.HMAC_PROPAGATION_KEY ?? "self_propagation_signer",
    });
    return new HmacAuthService(auth, redis);
  }

  listClientIds() {
    return this.auth.clients.listClientIds();
  }
}
