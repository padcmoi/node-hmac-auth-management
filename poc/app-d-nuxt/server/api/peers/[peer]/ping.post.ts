import { defineEventHandler, getRouterParam, readBody } from "h3";
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
  const body = await readBody(event).catch(() => ({}));
  try {
    const response = await signer(`${peerUrl}/secure/business`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: config.serviceName as string, payload: body }),
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // text body
    }
    return { peer, peerUrl, status: response.status, body: parsed };
  } catch (error) {
    return { peer, peerUrl, error: (error as Error).message };
  }
});
