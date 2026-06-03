import { defineEventHandler, getQuery } from "h3";

/**
 * Proxy: GET api_a /admin/data-plane?track=http|message - list seeds.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const query = getQuery(event);
  const track = query.track === "message" ? "message" : "http";
  const response = await fetch(`${config.adminApiABase as string}/admin/data-plane?track=${track}`);
  return response.json();
});
