import { initializeHmacHttpAuth } from "@naskot/node-hmac-auth";
import { describe, expect, it } from "vitest";
import { createHmacAuthManagement } from "../src/index.js";
import { createInMemoryCrud } from "./helpers/in-memory-crud.js";
import { FakeRedis } from "./helpers/fake-redis.js";

const PROPAGATION_KEY = "self_propagation_signer";
const ROUTE = "/api/internal/hmac";

function buildSourceAuth() {
  return initializeHmacHttpAuth({
    requireBootstrapClientId: PROPAGATION_KEY ?? "self_propagation_signer",
    redis: new FakeRedis(),
    namespace: "tenant_source",
    secretToken: "source_token_alpha",
    internalManagementRoute: ROUTE,
  });
}

describe("HmacAuthManagement - propagation-key safeguards", () => {
  it("refuses add/update/remove on the propagation-key clientId", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await expect(
      mgmt.http.add({
        clientId: PROPAGATION_KEY,
        secret: "evil",
        targets: ["http://target_a"],
      })
    ).rejects.toMatchObject({ code: "PROPAGATION_KEY_REMOVE_FORBIDDEN" });

    await expect(
      mgmt.http.update({
        clientId: PROPAGATION_KEY,
        newSecret: "evil",
      })
    ).rejects.toMatchObject({ code: "PROPAGATION_KEY_REMOVE_FORBIDDEN" });

    await expect(mgmt.http.remove({ clientId: PROPAGATION_KEY })).rejects.toMatchObject({
      code: "PROPAGATION_KEY_REMOVE_FORBIDDEN",
    });
  });

  it("track.add rejects duplicate clientIds with MANAGED_ROW_ALREADY_EXISTS", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await mgmt.http.add({
      clientId: "data_plane_alpha",
      secret: "first",
      targets: ["http://target_a"],
    });
    await expect(
      mgmt.http.add({
        clientId: "data_plane_alpha",
        secret: "second",
        targets: ["http://target_a"],
      })
    ).rejects.toMatchObject({ code: "MANAGED_ROW_ALREADY_EXISTS" });
  });

  it("track.update rejects unknown clientIds with MANAGED_ROW_NOT_FOUND", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await expect(mgmt.http.update({ clientId: "never_added", newSecret: "rotated" })).rejects.toMatchObject({
      code: "MANAGED_ROW_NOT_FOUND",
    });
  });
});
