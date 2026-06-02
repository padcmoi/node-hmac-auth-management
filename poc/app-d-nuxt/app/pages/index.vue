<template>
  <div class="space-y-10">
    <section>
      <h2 class="text-lg font-semibold mb-3">Local Redis (this app's own credential store)</h2>
      <div class="flex items-center gap-3 mb-3">
        <button
          class="px-3 py-1.5 rounded-md bg-slate-900 text-white text-sm disabled:opacity-50"
          :disabled="local.loading"
          @click="loadLocal"
        >
          Refresh
        </button>
        <span class="text-xs text-slate-500" v-if="local.data">{{ (local.data as any).service }}</span>
      </div>
      <ul
        v-if="local.data && (local.data as any).clientIds.length"
        class="bg-slate-900 text-slate-100 rounded-md p-4 text-sm font-mono"
      >
        <li v-for="id in (local.data as any).clientIds" :key="id">{{ id }}</li>
      </ul>
      <p v-else-if="local.loading" class="text-sm text-slate-500">Loading...</p>
      <p v-else class="text-sm text-slate-500">(empty)</p>
    </section>

    <section>
      <h2 class="text-lg font-semibold mb-3">Peers - credential stores</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <article v-for="peer in config.public.peers as string[]" :key="peer" class="rounded-lg border bg-white p-4">
          <header class="flex items-center justify-between mb-3">
            <h3 class="font-semibold">{{ peer }}</h3>
            <button
              class="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
              :disabled="peers[peer]?.loading"
              @click="loadPeer(peer)"
            >
              Fetch
            </button>
          </header>
          <pre v-if="peers[peer]?.data" class="text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-72">{{
            JSON.stringify(peers[peer].data, null, 2)
          }}</pre>
          <p v-else-if="peers[peer]?.loading" class="text-xs text-slate-500">Loading...</p>
          <p v-else class="text-xs text-slate-400">(no data yet)</p>
        </article>
      </div>
    </section>

    <section>
      <h2 class="text-lg font-semibold mb-3">Ping a peer's signed business route</h2>
      <p class="text-sm text-slate-600 mb-4">
        Each button signs <code class="bg-slate-200 px-1 rounded">POST &lt;peer&gt;/secure/business</code> with
        <code class="bg-slate-200 px-1 rounded">client_consumer_d</code> and renders the verbatim response. A 200 confirms
        cross-token verifiability end-to-end.
      </p>
      <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <article v-for="peer in config.public.peers as string[]" :key="`ping-${peer}`" class="rounded-lg border bg-white p-4">
          <header class="flex items-center justify-between mb-3">
            <h3 class="font-semibold">Ping {{ peer }}</h3>
            <button
              class="text-xs px-2 py-1 rounded bg-blue-600 text-white disabled:opacity-50"
              :disabled="pings[peer]?.loading"
              @click="ping(peer)"
            >
              Send signed POST
            </button>
          </header>
          <pre v-if="pings[peer]?.data" class="text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-72">{{
            JSON.stringify(pings[peer].data, null, 2)
          }}</pre>
          <p v-else-if="pings[peer]?.loading" class="text-xs text-slate-500">Loading...</p>
          <p v-else class="text-xs text-slate-400">(no data yet)</p>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
interface Slot {
  loading: boolean;
  data?: unknown;
  error?: string;
}
const config = useRuntimeConfig();
const local = ref<Slot>({ loading: false });
const peers = ref<Record<string, Slot>>({});
const pings = ref<Record<string, Slot>>({});

async function loadLocal() {
  local.value = { loading: true };
  try {
    local.value = { loading: false, data: await $fetch("/api/local/credentials") };
  } catch (error) {
    local.value = { loading: false, error: (error as Error).message };
  }
}
async function loadPeer(peer: string) {
  peers.value = { ...peers.value, [peer]: { loading: true } };
  try {
    const data = await $fetch(`/api/peers/${peer}/credentials`);
    peers.value = { ...peers.value, [peer]: { loading: false, data } };
  } catch (error) {
    peers.value = { ...peers.value, [peer]: { loading: false, error: (error as Error).message } };
  }
}
async function ping(peer: string) {
  pings.value = { ...pings.value, [peer]: { loading: true } };
  try {
    const data = await $fetch(`/api/peers/${peer}/ping`, {
      method: "POST",
      body: { message: `hello from ${config.public.serviceName as string} UI` },
    });
    pings.value = { ...pings.value, [peer]: { loading: false, data } };
  } catch (error) {
    pings.value = { ...pings.value, [peer]: { loading: false, error: (error as Error).message } };
  }
}

onMounted(() => {
  void loadLocal();
  for (const peer of config.public.peers as string[]) void loadPeer(peer);
});
</script>
