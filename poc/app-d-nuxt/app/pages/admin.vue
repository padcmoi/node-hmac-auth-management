<template>
  <div class="space-y-8">
    <header class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">api_a managed rows (MariaDB)</h2>
        <p class="text-sm text-slate-600">
          Drives api_a's BDD via its unauthenticated admin REST surface. Every mutation goes through the mgmt lib's
          <code class="bg-slate-200 px-1 rounded">mgmt.http.add / update / remove</code> so the propagation-key safeguards stay
          enforced.
        </p>
      </div>
      <div class="flex gap-3">
        <button class="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-sm" :disabled="state.loading" @click="load">
          Refresh
        </button>
        <button
          class="px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm disabled:opacity-50"
          :disabled="state.syncing"
          @click="syncNow"
        >
          Sync now
        </button>
      </div>
    </header>

    <section class="rounded-lg border bg-white p-4">
      <h3 class="font-semibold mb-3">Create row</h3>
      <form class="grid grid-cols-1 md:grid-cols-2 gap-3" @submit.prevent="create">
        <input v-model="newRow.clientId" placeholder="clientId" class="border rounded px-3 py-1.5 text-sm" required />
        <input v-model="newRow.secret" placeholder="secret (plain)" class="border rounded px-3 py-1.5 text-sm" required />
        <input
          v-model="newRow.targetsText"
          placeholder="targets (comma-separated URLs)"
          class="border rounded px-3 py-1.5 text-sm md:col-span-2"
          required
        />
        <input
          v-model="newRow.allowedIpsText"
          placeholder="allowedIps (optional, comma-separated)"
          class="border rounded px-3 py-1.5 text-sm md:col-span-2"
        />
        <button class="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm md:col-span-2" :disabled="state.creating">
          Create + mark pending
        </button>
      </form>
      <p v-if="state.createError" class="text-sm text-red-600 mt-2">{{ state.createError }}</p>
    </section>

    <section>
      <h3 class="font-semibold mb-3">Rows</h3>
      <p v-if="state.loading" class="text-sm text-slate-500">Loading...</p>
      <ul v-else-if="state.rows.length" class="space-y-3">
        <li v-for="row in state.rows" :key="row.id" class="rounded-lg border bg-white p-4">
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <p class="font-mono text-sm">
                <span class="font-semibold">{{ row.clientId }}</span>
                <span class="text-slate-400"> &middot; </span>
                <span class="text-xs">{{ row.kind }}</span>
                <span class="text-slate-400"> &middot; </span>
                <span
                  :class="{
                    'text-emerald-600': row.status === 'ok',
                    'text-amber-600': row.status === 'pending',
                    'text-rose-600': row.status === 'error',
                    'text-slate-400': row.status === 'delete_pending',
                  }"
                >
                  {{ row.status }}
                </span>
                <span v-if="row.attemptCount" class="text-slate-400 text-xs"> &middot; attempts={{ row.attemptCount }}</span>
              </p>
              <p class="text-xs text-slate-600">
                targets: <span class="font-mono">{{ row.targets?.join(", ") }}</span>
              </p>
              <p v-if="row.reason" class="text-xs text-rose-600 font-mono">reason: {{ row.reason }}</p>
              <p v-if="row.lastSyncedAt" class="text-xs text-slate-500">last synced: {{ row.lastSyncedAt }}</p>
            </div>
            <div class="flex flex-col gap-2 shrink-0">
              <button
                class="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                :disabled="state.loadingStates[row.id]"
                @click="loadDeliveryStates(row.id)"
              >
                Delivery states
              </button>
              <button
                v-if="row.kind === 'data_plane'"
                class="text-xs px-2 py-1 rounded bg-amber-500 text-white"
                @click="rotate(row)"
              >
                Rotate
              </button>
              <button
                v-if="row.kind === 'data_plane'"
                class="text-xs px-2 py-1 rounded bg-rose-600 text-white"
                @click="remove(row)"
              >
                Delete
              </button>
            </div>
          </div>
          <pre
            v-if="state.deliveryStates[row.id]"
            class="text-xs bg-slate-900 text-slate-100 rounded p-2 mt-3 overflow-auto max-h-60"
            >{{ JSON.stringify(state.deliveryStates[row.id], null, 2) }}</pre
          >
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500">(no rows yet)</p>
    </section>

    <section v-if="state.lastSync" class="rounded-lg border bg-white p-4">
      <h3 class="font-semibold mb-3">Last sync() summary</h3>
      <pre class="text-xs bg-slate-900 text-slate-100 rounded p-2 overflow-auto max-h-72">{{
        JSON.stringify(state.lastSync, null, 2)
      }}</pre>
    </section>
  </div>
</template>

<script setup lang="ts">
interface RowShape {
  id: string;
  clientId: string;
  kind: string;
  secret: string | null;
  targets: string[];
  allowedIps: string[] | null;
  status: string;
  reason: string | null;
  lastSyncedAt: string | null;
  attemptCount: number;
}

const state = reactive({
  loading: false,
  syncing: false,
  creating: false,
  createError: "" as string,
  rows: [] as RowShape[],
  loadingStates: {} as Record<string, boolean>,
  deliveryStates: {} as Record<string, unknown>,
  lastSync: null as unknown,
});

const newRow = reactive({
  clientId: "",
  secret: "",
  targetsText: "http://api_b:3000,http://api_c:3000",
  allowedIpsText: "",
});

async function load() {
  state.loading = true;
  try {
    const data = await $fetch("/api/admin/rows");
    state.rows = (data as any).rows ?? [];
  } finally {
    state.loading = false;
  }
}

async function create() {
  state.creating = true;
  state.createError = "";
  try {
    const targets = newRow.targetsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const allowedIps = newRow.allowedIpsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const response = await $fetch("/api/admin/rows", {
      method: "POST",
      body: {
        clientId: newRow.clientId,
        secret: newRow.secret,
        targets,
        allowedIps: allowedIps.length ? allowedIps : undefined,
      },
    });
    if (!(response as any).ok) {
      state.createError = (response as any).error ?? "create failed";
    } else {
      newRow.clientId = "";
      newRow.secret = "";
      await load();
    }
  } catch (error) {
    state.createError = (error as Error).message;
  } finally {
    state.creating = false;
  }
}

async function rotate(row: RowShape) {
  const newSecret = prompt(`New secret for ${row.clientId}:`);
  if (!newSecret) return;
  await $fetch(`/api/admin/rows/${row.id}`, {
    method: "PUT",
    body: { newSecret },
  });
  await load();
}

async function remove(row: RowShape) {
  if (!confirm(`Mark ${row.clientId} for deletion (will be removed at next sync)?`)) return;
  await $fetch(`/api/admin/rows/${row.id}`, { method: "DELETE" });
  await load();
}

async function loadDeliveryStates(rowId: string) {
  state.loadingStates[rowId] = true;
  try {
    const data = await $fetch(`/api/admin/delivery-states/${rowId}`);
    state.deliveryStates[rowId] = data;
  } finally {
    state.loadingStates[rowId] = false;
  }
}

async function syncNow() {
  state.syncing = true;
  try {
    state.lastSync = await $fetch("/api/admin/sync", { method: "POST" });
    await load();
  } finally {
    state.syncing = false;
  }
}

onMounted(() => void load());
</script>
