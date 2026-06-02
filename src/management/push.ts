import type { InitializedHmacHttpAuth, InitializedHmacMessageAuth, PropagateHmacClientOptions } from "@naskot/node-hmac-auth";

// `PropagateApiFetch` is defined upstream but not re-exported from the
// package barrel as of v1.3.0. We derive it from the optional `apiFetch`
// field of the propagation options to stay structurally aligned.
type PropagateApiFetch = NonNullable<PropagateHmacClientOptions["apiFetch"]>;

/**
 * Single-target push of a credential. Encapsulates the upstream lib's
 * `propagateClientToApis` call for one row, one operation, one target,
 * plus the create<->update swap retry on the two well-known FORBIDDEN
 * messages emitted by the management route.
 *
 * The caller is responsible for:
 *   - computing the `secretHash` to ship (with UUID enrichment for
 *     data-plane rows, with the source-local hash for the propagation
 *     key once it has been hashed at least once)
 *   - choosing the `apiFetch` signer (unsigned for bootstrap, signed by
 *     the propagation key for the rest)
 *   - tagging the wire payload with `purpose: "propagation-only"` for
 *     the propagation-key row and only that row
 *
 * Returned shape:
 *   - `accepted: true` when the target responded 201 either on the first
 *     attempt OR on the retry swap.
 *   - `accepted: false` otherwise; `reason` carries the upstream message.
 */
export interface PushRowToTargetInput {
  hmacAuth: InitializedHmacHttpAuth;
  trackStore: "http" | "message";
  target: string;
  clientId: string;
  secretHash: string;
  allowedIps?: string[] | null;
  purpose?: "propagation-only";
  signer?: PropagateApiFetch;
  operation: "create" | "update";
}

export interface PushRowResult {
  accepted: boolean;
  effectiveOperation: "create" | "update";
  reason?: string;
  status: number;
}

const FORBIDDEN_ALREADY_EXISTS = "Client already exists";
const FORBIDDEN_DOES_NOT_EXIST = "Client does not exist";

function extractForbiddenMessage(body: unknown) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") {
      return message;
    }
  }
  return undefined;
}

async function pushOnce(input: PushRowToTargetInput, operation: "create" | "update") {
  const results = await input.hmacAuth.propagateClientToApis({
    operation,
    targets: [input.target],
    clientId: input.clientId,
    secretHash: input.secretHash,
    allowedIps: input.allowedIps ?? [],
    targetStore: input.trackStore,
    purpose: input.purpose,
    apiFetch: input.signer,
    // Tag every push as DB-seed-originated so the target writes a TTL
    // backup of the previous hash on a rotation. The backup is what
    // makes `PATCH revert` meaningful during a partial-failure rollback.
    fromDbSeed: true,
  });
  return results[0];
}

export async function pushRowToTarget(input: PushRowToTargetInput) {
  const first = await pushOnce(input, input.operation);
  if (!first) {
    const fallback: PushRowResult = {
      accepted: false,
      effectiveOperation: input.operation,
      reason: "no propagation result returned",
      status: 0,
    };
    return fallback;
  }

  if (first.accepted) {
    const accepted: PushRowResult = {
      accepted: true,
      effectiveOperation: input.operation,
      status: first.status,
    };
    return accepted;
  }

  const message = extractForbiddenMessage(first.body);
  let alternativeOperation: "create" | "update" | null = null;
  if (message === FORBIDDEN_ALREADY_EXISTS && input.operation === "create") {
    alternativeOperation = "update";
  } else if (message === FORBIDDEN_DOES_NOT_EXIST && input.operation === "update") {
    alternativeOperation = "create";
  }

  if (alternativeOperation) {
    const swap = await pushOnce(input, alternativeOperation);
    if (swap?.accepted) {
      const swapped: PushRowResult = {
        accepted: true,
        effectiveOperation: alternativeOperation,
        status: swap.status,
      };
      return swapped;
    }
    const swapFailed: PushRowResult = {
      accepted: false,
      effectiveOperation: alternativeOperation,
      reason: extractForbiddenMessage(swap?.body) ?? `swap rejected with status ${swap?.status ?? 0}`,
      status: swap?.status ?? 0,
    };
    return swapFailed;
  }

  const refused: PushRowResult = {
    accepted: false,
    effectiveOperation: input.operation,
    reason: message ?? (typeof first.error === "string" ? first.error : `rejected with status ${first.status}`),
    status: first.status,
  };
  return refused;
}

export interface DeleteRowOnTargetInput {
  hmacAuth: InitializedHmacHttpAuth;
  trackStore: "http" | "message";
  target: string;
  clientId: string;
  signer?: PropagateApiFetch;
}

export async function deleteRowOnTarget(input: DeleteRowOnTargetInput) {
  const results = await input.hmacAuth.propagateClientToApis({
    operation: "delete",
    targets: [input.target],
    clientId: input.clientId,
    targetStore: input.trackStore,
    apiFetch: input.signer,
  });
  const result = results[0];
  if (!result) {
    return { accepted: false, status: 0, reason: "no delete result returned" };
  }
  if (result.accepted) {
    return { accepted: true, status: result.status };
  }
  if (extractForbiddenMessage(result.body) === FORBIDDEN_DOES_NOT_EXIST) {
    return { accepted: true, status: result.status, reason: "already absent" };
  }
  return {
    accepted: false,
    status: result.status,
    reason:
      extractForbiddenMessage(result.body) ??
      (typeof result.error === "string" ? result.error : `rejected with status ${result.status}`),
  };
}

export interface RevertRowOnTargetInput {
  hmacAuth: InitializedHmacHttpAuth;
  trackStore: "http" | "message";
  target: string;
  clientId: string;
  signer?: PropagateApiFetch;
}

export async function revertRowOnTarget(input: RevertRowOnTargetInput) {
  const results = await input.hmacAuth.propagateClientToApis({
    operation: "revert",
    targets: [input.target],
    clientId: input.clientId,
    targetStore: input.trackStore,
    apiFetch: input.signer,
  });
  const result = results[0];
  return {
    accepted: result?.accepted === true,
    status: result?.status ?? 0,
    reason:
      result && !result.accepted
        ? (extractForbiddenMessage(result.body) ?? (typeof result.error === "string" ? result.error : undefined))
        : undefined,
  };
}

/** Touch the message-auth typing graph so `tsc` flags an accidental break. */
export type _MessageAuthShape = InitializedHmacMessageAuth;
