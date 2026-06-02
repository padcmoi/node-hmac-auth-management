"use client";

import { useEffect, useState, useTransition } from "react";
import { listLocalCredentials, listPeerCredentials, pingPeer } from "./actions";

const PEERS = ["api_a", "api_b", "api_c", "app_d"] as const;
type PeerName = (typeof PEERS)[number];

interface Slot {
  loading: boolean;
  data?: unknown;
  error?: string;
}

export default function HomePage() {
  const [local, setLocal] = useState<Slot>({ loading: false });
  const [peers, setPeers] = useState<Record<string, Slot>>({});
  const [pings, setPings] = useState<Record<string, Slot>>({});
  const [, startTransition] = useTransition();

  async function loadLocal() {
    setLocal({ loading: true });
    try {
      const data = await listLocalCredentials();
      setLocal({ loading: false, data });
    } catch (error) {
      setLocal({ loading: false, error: (error as Error).message });
    }
  }

  async function loadPeer(peer: PeerName) {
    setPeers((prev) => ({ ...prev, [peer]: { loading: true } }));
    try {
      const data = await listPeerCredentials(peer);
      setPeers((prev) => ({ ...prev, [peer]: { loading: false, data } }));
    } catch (error) {
      setPeers((prev) => ({ ...prev, [peer]: { loading: false, error: (error as Error).message } }));
    }
  }

  async function ping(peer: PeerName) {
    setPings((prev) => ({ ...prev, [peer]: { loading: true } }));
    try {
      const data = await pingPeer(peer, { message: "hello from app_e_nextjs UI" });
      setPings((prev) => ({ ...prev, [peer]: { loading: false, data } }));
    } catch (error) {
      setPings((prev) => ({ ...prev, [peer]: { loading: false, error: (error as Error).message } }));
    }
  }

  useEffect(() => {
    startTransition(() => {
      void loadLocal();
      for (const peer of PEERS) void loadPeer(peer);
    });
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-10">
      <header className="border-b pb-4">
        <h1 className="text-2xl font-semibold">Next.js 15 - app_e_nextjs</h1>
        <p className="text-sm text-slate-600">
          Backend integrates <code className="bg-slate-200 px-1 rounded">@naskot/node-hmac-auth</code> via a singleton. Buttons
          trigger Server Actions; the action signs the outbound request with
          <code className="bg-slate-200 px-1 rounded mx-1">client_consumer_e</code>
          (propagated by api_a) and returns the verbatim peer response.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold mb-3">Local Redis (this app's own credential store)</h2>
        <button
          className="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
          disabled={local.loading}
          onClick={loadLocal}
        >
          Refresh
        </button>
        {local.data && (
          <pre className="mt-3 text-xs bg-slate-900 text-slate-100 rounded p-3 overflow-auto max-h-72">
            {JSON.stringify(local.data, null, 2)}
          </pre>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Peers - credential stores</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PEERS.map((peer) => (
            <article key={peer} className="rounded-lg border bg-white p-4">
              <header className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">{peer}</h3>
                <button
                  className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                  disabled={peers[peer]?.loading}
                  onClick={() => void loadPeer(peer)}
                >
                  Fetch
                </button>
              </header>
              {peers[peer]?.data ? (
                <pre className="text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-72">
                  {JSON.stringify(peers[peer].data, null, 2)}
                </pre>
              ) : peers[peer]?.loading ? (
                <p className="text-xs text-slate-500">Loading...</p>
              ) : (
                <p className="text-xs text-slate-400">(no data yet)</p>
              )}
            </article>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Ping a peer's signed business route</h2>
        <p className="text-sm text-slate-600 mb-4">
          Each button calls a Server Action that signs{" "}
          <code className="bg-slate-200 px-1 rounded">POST &lt;peer&gt;/secure/business</code> with{" "}
          <code className="bg-slate-200 px-1 rounded">client_consumer_e</code> and renders the verbatim response.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {PEERS.map((peer) => (
            <article key={`ping-${peer}`} className="rounded-lg border bg-white p-4">
              <header className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Ping {peer}</h3>
                <button
                  className="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
                  disabled={pings[peer]?.loading}
                  onClick={() => void ping(peer)}
                >
                  Send signed POST
                </button>
              </header>
              {pings[peer]?.data ? (
                <pre className="text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-72">
                  {JSON.stringify(pings[peer].data, null, 2)}
                </pre>
              ) : pings[peer]?.loading ? (
                <p className="text-xs text-slate-500">Loading...</p>
              ) : (
                <p className="text-xs text-slate-400">(no data yet)</p>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
