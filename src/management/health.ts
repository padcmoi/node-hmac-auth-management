import type { InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import type { TargetHealth } from "../core/types.js";

/**
 * Issue a single `GET internalManagementRoute` probe on a target and
 * normalize the response into a `TargetHealth`.
 *
 * Implementation note:
 *   - The upstream lib exposes `propagateClientToApis({ operation:
 *     "health" })` which fans the GET out and returns `{ status, body }`.
 *     We always sign the probe with the local propagation-key credential
 *     (when it is present in the source-side HMAC auth) so a target that
 *     went past its bootstrap window does not respond 403.
 *   - Targets running upstream `< v1.3.0` omit `bootstrapLocked` from the
 *     body. We default it to `false` to keep the consumer code total.
 *   - On a network / DNS / TLS error the upstream lib returns
 *     `accepted: false` and an `error` string; we surface that in
 *     `TargetHealth` so the consumer can distinguish unreachable targets
 *     from refused ones.
 */
export interface ProbeTargetDeps {
  hmacAuth: InitializedHmacHttpAuth;
  signerApiFetch?: (url: string, options?: unknown) => Promise<Response>;
}

interface ProbeBodyShape {
  ok?: boolean;
  namespace?: string;
  route?: string;
  authRequired?: boolean;
  clientsCount?: number;
  bootstrapLocked?: boolean;
}

function toProbeBody(body: unknown) {
  if (body && typeof body === "object") {
    return body as ProbeBodyShape;
  }
  return {};
}

export async function probeTarget(deps: ProbeTargetDeps, target: string) {
  const apiFetch = deps.signerApiFetch ?? globalThis.fetch;
  if (typeof apiFetch !== "function") {
    throw new Error("No fetch implementation available for health probe");
  }

  const results = await deps.hmacAuth.propagateClientToApis({
    operation: "health",
    targets: [target],
    apiFetch: apiFetch as never,
  });

  const result = results[0];
  if (!result) {
    const fallback: TargetHealth = {
      target,
      reachable: false,
      clientsCount: 0,
      authRequired: false,
      bootstrapLocked: false,
      namespace: "",
      route: "",
      error: "no probe result returned by propagateClientToApis",
    };
    return fallback;
  }

  if (!result.accepted) {
    const errorText = typeof result.error === "string" ? result.error : `probe rejected with status ${result.status}`;
    const health: TargetHealth = {
      target,
      reachable: result.status !== 0,
      clientsCount: 0,
      authRequired: false,
      bootstrapLocked: false,
      namespace: "",
      route: "",
      error: errorText,
    };
    return health;
  }

  const body = toProbeBody(result.body);
  const health: TargetHealth = {
    target,
    reachable: true,
    clientsCount: typeof body.clientsCount === "number" ? body.clientsCount : 0,
    authRequired: body.authRequired === true,
    bootstrapLocked: body.bootstrapLocked === true,
    namespace: typeof body.namespace === "string" ? body.namespace : "",
    route: typeof body.route === "string" ? body.route : "",
  };
  return health;
}
