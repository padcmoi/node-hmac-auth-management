import { defineEventHandler } from "h3";

/**
 * Proxy: GET api_a /admin/propagation-key/targets - list the inalienable
 * target list + per-target delivery state.
 */
export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const response = await fetch(`${config.adminApiABase as string}/admin/propagation-key/targets`);
  return response.json();
});
