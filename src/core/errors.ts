/**
 * Typed error class raised by `createHmacAuthManagement` and its tracks.
 *
 * The list below is normative; any new code added in a future release MUST
 * be appended (additive) so consumers that pattern-match on `code` stay
 * forward-compatible.
 */
export type HmacAuthMgmtErrorCode =
  | "PROPAGATION_KEY_REMOVE_FORBIDDEN"
  | "PROPAGATION_KEY_MISSING"
  | "MANAGED_ROW_NOT_FOUND"
  | "MANAGED_ROW_ALREADY_EXISTS"
  | "INVALID_OPTIONS"
  | "INVALID_INPUT"
  | "TARGET_PROBE_FAILED"
  | "INTERNAL_ERROR";

export class HmacAuthMgmtError extends Error {
  public readonly code: HmacAuthMgmtErrorCode;
  public readonly status: number;

  constructor(code: HmacAuthMgmtErrorCode, message: string, status = 400) {
    super(message);
    this.name = "HmacAuthMgmtError";
    this.code = code;
    this.status = status;
  }
}
