import { defineEventHandler, getRequestURL, readRawBody, setResponseStatus } from "h3";
import { getHmacAuthService } from "../utils/hmac-auth.service";

/**
 * h3 (Nitro) middleware: dispatches GET/POST/PUT/PATCH/DELETE on the
 * configured `internalManagementRoute` by calling the upstream lib's
 * `handleInternalManagementRequest` directly (no need to go through
 * an Express adapter).
 *
 * When the URL is anything else, the handler simply returns and Nitro
 * continues route resolution.
 */
export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);
  const config = useRuntimeConfig();
  const route = config.hmacInternalManagementRoute as string;
  if (url.pathname !== route) return;

  const runtime = await getHmacAuthService();
  const method = event.method.toUpperCase();
  const headers: Record<string, string> = {};
  const raw = event.node.req.headers as Record<string, string | string[] | undefined>;
  for (const [k, v] of Object.entries(raw)) {
    if (Array.isArray(v)) headers[k] = v[0] ?? "";
    else if (typeof v === "string") headers[k] = v;
  }
  const rawBody = method === "GET" ? "" : ((await readRawBody(event)) ?? "");
  const result = await runtime.auth.handleInternalManagementRequest({
    method,
    path: `${url.pathname}${url.search}`,
    headers,
    rawBody,
    now: Date.now(),
  });
  setResponseStatus(event, result.status);
  return result.body;
});
