"use server";

import { dumpAll, dumpPeer, type PeerName, type RedisDump } from "@/server/redis-viewer.service";

export async function fetchAllRedisDumps(): Promise<RedisDump[]> {
  return dumpAll();
}

export async function fetchPeerRedisDump(peer: PeerName): Promise<RedisDump> {
  return dumpPeer(peer);
}
