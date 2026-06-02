"use server";

import { config, getHmacAuthService } from "@/server/hmac-auth.service";

/**
 * Server Actions called from the Next.js client component.
 *
 * Every action runs on the server and may freely access the singleton
 * HMAC runtime to sign outbound requests with the propagated
 * `client_consumer_e` credential. The action result is serialized back
 * to the client; secrets stay on the server.
 */

function resolvePeerUrl(peer: string) {
  const peers = config.peers();
  return (peers as Record<string, string>)[peer] ?? null;
}

export async function listLocalCredentials() {
  const runtime = await getHmacAuthService();
  const clientIds = await runtime.auth.clients.listClientIds();
  return { service: config.serviceName(), clientIds };
}

export async function listPeerCredentials(peer: string) {
  const peerUrl = resolvePeerUrl(peer);
  if (!peerUrl) return { error: "unknown peer", peer };
  const runtime = await getHmacAuthService();
  const signingClientId = config.signingClientId();
  const stored = await runtime.auth.clients.get(signingClientId);
  if (!stored) {
    return {
      error: "signing credential not yet propagated to this service",
      hint: `Wait for api_a to push '${signingClientId}' to ${config.serviceName()} via sync()`,
    };
  }
  const signer = runtime.auth.createHttpSignedFetchClient({
    clientId: signingClientId,
    secret: stored.secretHash,
    secretIsHashed: true,
  });
  try {
    const response = await signer(`${peerUrl}/secure/credentials/local`, { method: "GET" });
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
}

export async function pingPeer(peer: string, payload: unknown) {
  const peerUrl = resolvePeerUrl(peer);
  if (!peerUrl) return { error: "unknown peer", peer };
  const runtime = await getHmacAuthService();
  const signingClientId = config.signingClientId();
  const stored = await runtime.auth.clients.get(signingClientId);
  if (!stored) {
    return {
      error: "signing credential not yet propagated to this service",
      hint: `Wait for api_a to push '${signingClientId}' to ${config.serviceName()} via sync()`,
    };
  }
  const signer = runtime.auth.createHttpSignedFetchClient({
    clientId: signingClientId,
    secret: stored.secretHash,
    secretIsHashed: true,
  });
  try {
    const response = await signer(`${peerUrl}/secure/business`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: config.serviceName(), payload }),
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
}
