import { initializeHmacHttpAuth, type InitializedHmacHttpAuth } from "@naskot/node-hmac-auth";
import { afterEach, describe, expect, it } from "vitest";
import { createHmacAuthManagement } from "../src/index.js";
import { createInMemoryCrud } from "./helpers/in-memory-crud.js";
import { FakeRedis } from "./helpers/fake-redis.js";
import { installFakeTargetMesh, type FakeTargetMeshHandle } from "./helpers/fake-target-mesh.js";

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

function buildTargetAuth(label: string, secretToken: string) {
  return initializeHmacHttpAuth({
    requireBootstrapClientId: PROPAGATION_KEY,
    redis: new FakeRedis(),
    namespace: `tenant_${label}`,
    secretToken,
    internalManagementRoute: ROUTE,
  });
}

let meshHandle: FakeTargetMeshHandle | null = null;

afterEach(() => {
  if (meshHandle) {
    meshHandle.restore();
    meshHandle = null;
  }
});

describe("HmacAuthManagement.http.sync - end-to-end", () => {
  it("first sync bootstraps each target and propagates the data-plane row", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const targetA = buildTargetAuth("target_a", "target_token_beta");
    const targetB = buildTargetAuth("target_b", "target_token_gamma");
    const targetAUrl = "http://target_a";
    const targetBUrl = "http://target_b";

    meshHandle = installFakeTargetMesh([
      { baseUrl: targetAUrl, auth: targetA },
      { baseUrl: targetBUrl, auth: targetB },
    ]);

    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await mgmt.http.add({
      clientId: "data_plane_alpha",
      secret: "alpha-secret",
      targets: [targetAUrl, targetBUrl],
      allowedIps: [],
    });

    const summary = await mgmt.http.sync();

    expect(summary.rows.processed).toBe(2); // propagation key + data-plane row
    expect(summary.rows.propagated).toBe(1);
    expect(summary.rows.errored).toBe(0);
    expect(summary.propagationKey.pushedThisSync).toBe(true);
    expect(summary.propagationKey.targets.delivered.sort()).toEqual([targetAUrl, targetBUrl].sort());
    expect(summary.propagationKey.targets.errored).toEqual([]);

    // Source local Redis now holds the propagation key + the data-plane credential
    const propKeyLocal = await hmacHttpAuth.clients.get(PROPAGATION_KEY);
    expect(propKeyLocal).not.toBeNull();
    expect(propKeyLocal?.purpose).toBe("propagation-only");

    const dataLocal = await hmacHttpAuth.clients.get("data_plane_alpha");
    expect(dataLocal).not.toBeNull();

    // Targets hold byte-identical hashes for both credentials
    const propKeyTargetA = await targetA.clients.get(PROPAGATION_KEY);
    const propKeyTargetB = await targetB.clients.get(PROPAGATION_KEY);
    expect(propKeyTargetA?.secretHash).toBe(propKeyLocal?.secretHash);
    expect(propKeyTargetB?.secretHash).toBe(propKeyLocal?.secretHash);

    const dataTargetA = await targetA.clients.get("data_plane_alpha");
    const dataTargetB = await targetB.clients.get("data_plane_alpha");
    expect(dataTargetA?.secretHash).toBe(dataLocal?.secretHash);
    expect(dataTargetB?.secretHash).toBe(dataLocal?.secretHash);

    // BDD state: propagation key now status=ok with both targets; data-plane row status=ok, secret cleared
    const propRowFinal = await crud.getPropagationKeyRow();
    expect(propRowFinal?.status).toBe("ok");
    expect(propRowFinal?.secret).toBeNull();
    expect(propRowFinal?.targets.sort()).toEqual([targetAUrl, targetBUrl].sort());

    const dataRowFinal = await crud.getByClientId("data_plane_alpha");
    expect(dataRowFinal?.status).toBe("ok");
    expect(dataRowFinal?.secret).toBeNull();
    expect(dataRowFinal?.attemptCount).toBe(1);

    // Second sync is a no-op (no pending rows)
    const second = await mgmt.http.sync();
    expect(second.rows.processed).toBe(0);
    expect(second.rows.propagated).toBe(0);
    expect(second.propagationKey.pushedThisSync).toBe(false);
  });

  it("rollbacks atomically when one target refuses the push", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const targetA = buildTargetAuth("target_a", "target_token_beta");
    const targetAUrl = "http://target_a";
    const unreachableUrl = "http://target_unreachable";

    meshHandle = installFakeTargetMesh([
      { baseUrl: targetAUrl, auth: targetA },
      // unreachable: no entry in the mesh -> throws on routing
    ]);

    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await mgmt.http.add({
      clientId: "data_plane_alpha",
      secret: "alpha-secret",
      targets: [targetAUrl, unreachableUrl],
      allowedIps: [],
    });

    const summary = await mgmt.http.sync();
    expect(summary.rows.errored).toBe(1);
    expect(summary.rows.propagated).toBe(0);

    // BDD row marked errored, secret cleared
    const dataRow = await crud.getByClientId("data_plane_alpha");
    expect(dataRow?.status).toBe("error");
    expect(dataRow?.secret).toBeNull();
    expect(dataRow?.reason).toContain("unreachable");

    // Target A had nothing previously, the rollback (PATCH revert) on a record
    // that never existed before is a no-op; the record should NOT exist now.
    const onTargetA = await targetA.clients.get("data_plane_alpha");
    expect(onTargetA).toBeNull();

    // Source local: also rolled back to absent
    const onSource = await hmacHttpAuth.clients.get("data_plane_alpha");
    expect(onSource).toBeNull();
  });

  it("propagates remove via Phase D: targets drop the credential and the row is purged from the CRUD", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const targetA = buildTargetAuth("target_a", "target_token_beta");
    const targetAUrl = "http://target_a";

    meshHandle = installFakeTargetMesh([{ baseUrl: targetAUrl, auth: targetA }]);

    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await mgmt.http.add({
      clientId: "data_plane_alpha",
      secret: "alpha-secret",
      targets: [targetAUrl],
      allowedIps: [],
    });
    await mgmt.http.sync();
    expect(await targetA.clients.get("data_plane_alpha")).not.toBeNull();

    await mgmt.http.remove({ clientId: "data_plane_alpha" });
    const removeSummary = await mgmt.http.sync();
    expect(removeSummary.rows.deleted).toBe(1);

    expect(await targetA.clients.get("data_plane_alpha")).toBeNull();
    expect(await hmacHttpAuth.clients.get("data_plane_alpha")).toBeNull();
    expect(await crud.getByClientId("data_plane_alpha")).toBeNull();
  });

  it("detects a target reset (clientsCount=0 with prior delivered) and re-pushes the propagation key", async () => {
    const { crud } = createInMemoryCrud();
    const hmacHttpAuth = buildSourceAuth();
    const targetARedis = new FakeRedis();
    const targetA: InitializedHmacHttpAuth = initializeHmacHttpAuth({
      requireBootstrapClientId: PROPAGATION_KEY,
      redis: targetARedis,
      namespace: "tenant_target_a",
      secretToken: "target_token_beta",
      internalManagementRoute: ROUTE,
    });
    const targetAUrl = "http://target_a";

    meshHandle = installFakeTargetMesh([{ baseUrl: targetAUrl, auth: targetA }]);

    const mgmt = await createHmacAuthManagement({
      hmacHttpAuth,
      propagationKey: PROPAGATION_KEY,
      http: { crud },
    });

    await mgmt.http.add({
      clientId: "data_plane_alpha",
      secret: "alpha-secret",
      targets: [targetAUrl],
      allowedIps: [],
    });
    await mgmt.http.sync();
    expect(await targetA.clients.get(PROPAGATION_KEY)).not.toBeNull();

    // Wipe target A's Redis: simulates a disaster recovery / cluster
    // restart that lost the credential store.
    targetARedis.wipe();
    expect(await targetA.clients.get(PROPAGATION_KEY)).toBeNull();

    // Insert a fresh data-plane row pointing at the same target.
    await mgmt.http.add({
      clientId: "data_plane_beta",
      secret: "beta-secret",
      targets: [targetAUrl],
      allowedIps: [],
    });

    const recoverySummary = await mgmt.http.sync();
    expect(recoverySummary.propagationKey.pushedThisSync).toBe(true);
    expect(recoverySummary.propagationKey.targets.delivered).toEqual([targetAUrl]);
    expect(recoverySummary.rows.propagated).toBeGreaterThanOrEqual(1);

    expect(await targetA.clients.get(PROPAGATION_KEY)).not.toBeNull();
    expect(await targetA.clients.get("data_plane_beta")).not.toBeNull();
  });
});
