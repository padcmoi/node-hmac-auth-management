import { initializeHmacHttpAuth } from "@naskot/node-hmac-auth";
import { describe, expect, it } from "vitest";
import { createHmacAuthManagement, deriveSecretV1 } from "../src/index.js";
import { createInMemoryCrud } from "./helpers/in-memory-crud.js";
import { FakeRedis } from "./helpers/fake-redis.js";

const PROPAGATION_KEY = "self_propagation_signer";
const ROUTE = "/api/internal/hmac";
const TOKEN = "source_token_alpha";

function buildSourceAuth() {
  return initializeHmacHttpAuth({
    redis: new FakeRedis(),
    namespace: "tenant_source",
    secretToken: TOKEN,
    internalManagementRoute: ROUTE,
  });
}

describe("createHmacAuthManagement - auto-seed", () => {
  it("inserts the propagation-key row when the CRUD is empty", async () => {
    const { crud, rows } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    expect(rows.size).toBe(0);

    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    expect(rows.size).toBe(1);
    const seeded = await crud.getPropagationKeyRow();
    expect(seeded).not.toBeNull();
    expect(seeded?.clientId).toBe(PROPAGATION_KEY);
    expect(seeded?.kind).toBe("propagation_key");
    expect(seeded?.secret).toBe(deriveSecretV1(TOKEN, PROPAGATION_KEY));
    expect(seeded?.status).toBe("pending");
    expect(seeded?.targets).toEqual([]);
    expect(mgmt.propagationKey).toBe(PROPAGATION_KEY);
  });

  it("is idempotent: a second boot reuses the existing row", async () => {
    const { crud, rows } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });
    const firstRow = await crud.getPropagationKeyRow();
    expect(rows.size).toBe(1);

    await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });
    const secondRow = await crud.getPropagationKeyRow();
    expect(rows.size).toBe(1);
    expect(secondRow?.id).toBe(firstRow?.id);
  });

  it("refuses to boot without hmacHttpAuth", async () => {
    const { crud } = createInMemoryCrud();
    await expect(
      createHmacAuthManagement({
        // @ts-expect-error intentionally invalid
        hmacHttpAuth: undefined,
        propagationKey: PROPAGATION_KEY,
        http: { crud },
      })
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("refuses to boot without a non-empty propagationKey", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    await expect(
      createHmacAuthManagement({
        hmacHttpAuth,
        propagationKey: "   ",
        http: { crud },
      })
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  });

  it("refuses to boot when hmacHttpAuth has no secretToken", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = initializeHmacHttpAuth({
      redis: new FakeRedis(),
      namespace: "tenant_no_token",
      internalManagementRoute: ROUTE,
    });
    await expect(
      createHmacAuthManagement({
        hmacHttpAuth,
        propagationKey: PROPAGATION_KEY,
        http: { crud },
      })
    ).rejects.toMatchObject({ code: "INVALID_OPTIONS" });
  });
});
