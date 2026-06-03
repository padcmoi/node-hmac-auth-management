import { defineEventHandler, readBody } from "h3";

/**
 * Proxy: POST api_a /admin/propagation-key/targets - add (union) a target.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const body = await readBody(event);
  const response = await fetch(`${config.adminApiABase as string}/admin/propagation-key/targets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
});
