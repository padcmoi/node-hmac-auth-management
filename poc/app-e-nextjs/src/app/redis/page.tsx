"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { fetchAllRedisDumps, fetchPeerRedisDump } from "./actions";
import type { PeerName, RedisDump } from "@/server/redis-viewer.service";

const PEERS: ReadonlyArray<PeerName> = ["api_a", "api_b", "api_c", "app_d", "app_e"];
const AUTO_REFRESH_MS = 2000;

export default function RedisViewerPage() {
  const [dumps, setDumps] = useState<Record<PeerName, RedisDump | undefined>>({
    api_a: undefined,
    api_b: undefined,
    api_c: undefined,
    app_d: undefined,
    app_e: undefined,
  });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  async function refreshAll() {
    if (inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const result = await fetchAllRedisDumps();
      const next: Record<PeerName, RedisDump | undefined> = {
        api_a: undefined,
        api_b: undefined,
        api_c: undefined,
        app_d: undefined,
        app_e: undefined,
      };
      for (const dump of result) next[dump.peer] = dump;
      setDumps(next);
    } finally {
      setLoading(false);
      inflight.current = false;
    }
  }

  async function refreshOne(peer: PeerName) {
    const dump = await fetchPeerRedisDump(peer);
    setDumps((prev) => ({ ...prev, [peer]: dump }));
  }

  useEffect(() => {
    void refreshAll();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void refreshAll();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
      <header className="border-b pb-4 flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Redis viewer - all peers, realtime</h1>
          <p className="text-sm text-slate-600 mt-1">
            Read-only dump of every peer Redis on the Docker internal network. No HMAC, no peer endpoint - this Next.js Server
            Action opens a direct Redis client to each instance. Nonces are filtered out.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)} />
            auto-refresh ({Math.round(AUTO_REFRESH_MS / 1000)}s)
          </label>
          <button
            className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
            disabled={loading}
            onClick={() => void refreshAll()}
          >
            {loading ? "Refreshing..." : "Refresh now"}
          </button>
          <Link href="/" className="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-sm">
            Back to home
          </Link>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {PEERS.map((peer) => {
          const dump = dumps[peer];
          return (
            <article key={peer} className="rounded-lg border bg-white p-4 space-y-3">
              <header className="flex items-center justify-between">
                <div>
                  <h2 className="font-semibold">{peer}</h2>
                  <p className="text-xs text-slate-500 font-mono">
                    {dump?.url ?? "(unknown url)"} - ns=<span className="text-slate-800">{dump?.namespace ?? "?"}</span>
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">
                    {dump ? `${dump.entries.length} keys (${dump.skippedNonces} nonces skipped)` : "(loading)"}
                  </span>
                  <button
                    className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                    onClick={() => void refreshOne(peer)}
                  >
                    Refresh
                  </button>
                </div>
              </header>
              {dump && !dump.ok && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                  {dump.error ?? "unknown error"}
                </p>
              )}
              {dump && dump.ok && dump.entries.length === 0 && <p className="text-xs text-slate-400">(empty redis)</p>}
              {dump && dump.ok && dump.entries.length > 0 && (
                <div className="space-y-2 max-h-[28rem] overflow-auto pr-2">
                  {dump.entries.map((entry) => (
                    <div key={entry.key} className="rounded border bg-slate-50 p-2">
                      <p className="text-xs font-mono break-all">
                        <span className="font-semibold text-slate-900">{entry.key}</span>
                        <span className="ml-2 text-slate-400">
                          type={entry.type}
                          {entry.ttlSeconds !== null && ` ttl=${entry.ttlSeconds}s`}
                        </span>
                      </p>
                      <pre className="mt-1 text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-auto">
                        {JSON.stringify(entry.value, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
              {dump && <p className="text-[10px] text-slate-400 font-mono">fetchedAt: {dump.fetchedAt}</p>}
            </article>
          );
        })}
      </div>
    </div>
  );
}
