import type { InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";

/**
 * Builds a fake-target mesh by intercepting `globalThis.fetch`. Each
 * target is registered against its base URL (e.g. "http://target_a")
 * and routed to its own `handleInternalManagementRequest`. The
 * cross-token contract is exercised end-to-end because each target gets
 * its own upstream-initialized instance with a distinct secretToken.
 *
 * Returns a `{ restore }` handle so each test tears down the global
 * patch in afterEach.
 */
export interface FakeTargetMeshHandle {
  restore: () => void;
}

export interface TargetEntry {
  baseUrl: string;
  auth: InitializedHmacHttpAuth;
}

function normalizeHeaders(input: HeadersInit | undefined) {
  const out: Record<string, string> = {};
  if (!input) return out;
  if (input instanceof Headers) {
    for (const [k, v] of input.entries()) out[k] = v;
    return out;
  }
  if (Array.isArray(input)) {
    for (const [k, v] of input) out[k] = v;
    return out;
  }
  for (const [k, v] of Object.entries(input)) {
    if (Array.isArray(v)) {
      out[k] = v[0] ?? "";
    } else if (typeof v === "string") {
      out[k] = v;
    }
  }
  return out;
}

function normalizeBody(body: unknown) {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof Uint8Array) return Buffer.from(body).toString("utf8");
  return "";
}

export function installFakeTargetMesh(targets: TargetEntry[]) {
  const originalFetch = globalThis.fetch;

  const router = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const match = targets.find((t) => url.startsWith(t.baseUrl));
    if (!match) {
      throw new Error(`fake-target-mesh: no target matches '${url}'`);
    }
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    const result = await match.auth.handleInternalManagementRequest({
      method: (init?.method ?? "GET").toUpperCase(),
      path,
      headers: normalizeHeaders(init?.headers),
      rawBody: normalizeBody(init?.body),
      now: Date.now(),
    });
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { "content-type": "application/json" },
    });
  };

  globalThis.fetch = router as typeof fetch;

  const handle: FakeTargetMeshHandle = {
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
  return handle;
}
