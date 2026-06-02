import { getHmacAuthService } from "../utils/hmac-auth.service";

/**
 * Nitro startup plugin: eagerly initialize the singleton HMAC auth
 * service so the first incoming request does not pay the Redis-connect
 * latency. The actual surface is reached via `getHmacAuthService()`
 * from server routes / middlewares.
 */
export default defineNitroPlugin(async () => {
  await getHmacAuthService();
  console.info("[app_d] hmac auth service initialized");
});
