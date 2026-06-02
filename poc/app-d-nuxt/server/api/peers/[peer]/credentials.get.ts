import { defineEventHandler, getRouterParam } from "h3";
import { getHmacAuthService, resolvePeerUrl } from "../../../utils/hmac-auth.service";

export default defineEventHandler(async (event) => {
  const peer = getRouterParam(event, "peer") ?? "";
  const peerUrl = resolvePeerUrl(peer);
  if (!peerUrl) return { error: "unknown peer", peer };

  const config = useRuntimeConfig();
  const runtime = await getHmacAuthService();
  const signingClientId = config.signingClientId as string;
  const stored = await runtime.auth.clients.get(signingClientId);
  if (!stored) {
    return {
      error: "signing credential not yet propagated to this service",
      hint: `Wait for api_a to push '${signingClientId}' to ${config.serviceName as string} via sync()`,
    };
  }
  const signer = runtime.auth.createHttpSignedFetchClient({
    clientId: signingClientId,
    secret: stored.secretHash,
    secretIsHashed: true,
  });
  try {
    const response = await signer(`${peerUrl}/secure/credentials/local`, { method: "GET" });
    const body = await response.text();
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body);
    } catch {
      // text body
    }
    return { peer, peerUrl, status: response.status, body: parsed };
  } catch (error) {
    return { peer, peerUrl, error: (error as Error).message };
  }
});
