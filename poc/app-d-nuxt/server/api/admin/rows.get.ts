import { defineEventHandler } from "h3";

/**
 * Proxy for api_a's admin endpoint listing every managed row in MariaDB.
 * No HMAC signature is added: api_a's admin endpoints are intentionally
 * unauthenticated for the POC ("pas d'authentification car c'est du test").
 */
export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const response = await fetch(`${config.adminApiABase as string}/admin/rows`);
  return response.json();
});
