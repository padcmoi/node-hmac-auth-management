<template>
  <div class="space-y-10">
    <header class="flex items-center justify-between">
      <div>
        <h2 class="text-lg font-semibold">api_a managed BDD (MariaDB - 3 tables)</h2>
        <p class="text-sm text-slate-600">
          v0.2.0 r3 - la cle <code class="bg-slate-200 px-1 rounded">self_propagation_signer</code> est inalienable et interne a
          la lib (clientId hardcode, secret derive au boot). Seuls SES TARGETS sont en BDD, dans
          <code class="bg-slate-200 px-1 rounded">hmac_http_propagation_key_targets</code>. La cle elle-meme ne peut etre ni
          modifiee ni supprimee depuis cette UI.
        </p>
      </div>
      <div class="flex gap-3">
        <button class="px-3 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-sm" :disabled="state.loading" @click="loadAll">
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
      <h3 class="font-semibold mb-3">
        Targets de la propagation key (<code class="bg-slate-200 px-1 rounded">hmac_http_propagation_key_targets</code>)
      </h3>
      <p v-if="state.loading" class="text-sm text-slate-500">Loading...</p>
      <table v-else class="w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500 border-b">
            <th class="py-1 pr-2">target</th>
            <th class="py-1 pr-2">state</th>
            <th class="py-1 pr-2">attempts</th>
            <th class="py-1 pr-2">lastAttemptAt</th>
            <th class="py-1 pr-2">lastDeliveredAt</th>
            <th class="py-1 pr-2">reason</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in state.propKeyTargets" :key="row.target" class="border-b last:border-b-0">
            <td class="py-1 pr-2 font-mono">{{ row.target }}</td>
            <td class="py-1 pr-2" :class="stateClass(row.state)">{{ row.state }}</td>
            <td class="py-1 pr-2">{{ row.attemptCount }}</td>
            <td class="py-1 pr-2">{{ row.lastAttemptAt ?? "-" }}</td>
            <td class="py-1 pr-2">{{ row.lastDeliveredAt ?? "-" }}</td>
            <td class="py-1 pr-2">{{ row.reason ?? "-" }}</td>
          </tr>
          <tr v-if="!state.propKeyTargets.length">
            <td colspan="6" class="py-2 text-center text-slate-400">aucun target seede pour la prop key</td>
          </tr>
        </tbody>
      </table>
      <form class="flex gap-2 items-end mt-3" @submit.prevent="addPropKeyTarget">
        <div class="flex-1">
          <label class="block text-xs text-slate-500">Add a target (UNION only, never shrinks)</label>
          <input v-model="newPropKeyTarget" placeholder="http://api_b:3000" class="border rounded w-full px-3 py-1.5 text-sm" />
        </div>
        <button class="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm" :disabled="state.propKeySaving">
          Add target
        </button>
      </form>
      <p v-if="state.propKeyError" class="text-sm text-red-600 mt-1">{{ state.propKeyError }}</p>
    </section>

    <section class="rounded-lg border bg-white p-4">
      <div class="flex items-center justify-between mb-3">
        <h3 class="font-semibold">Data-plane seeds (<code class="bg-slate-200 px-1 rounded">hmac_data_plane_seed</code>)</h3>
        <div class="text-xs">
          <label class="mr-1">track:</label>
          <select v-model="state.track" class="border rounded px-2 py-1" @change="loadAll">
            <option value="http">http</option>
            <option value="message">message</option>
          </select>
        </div>
      </div>
      <form class="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4" @submit.prevent="createSeed">
        <input v-model="newSeed.clientId" placeholder="clientId" class="border rounded px-3 py-1.5 text-sm" required />
        <input v-model="newSeed.secret" placeholder="secret (plain)" class="border rounded px-3 py-1.5 text-sm" required />
        <input
          v-model="newSeed.targetsText"
          placeholder="targets (comma-separated URLs)"
          class="border rounded px-3 py-1.5 text-sm md:col-span-2"
          required
        />
        <input
          v-model="newSeed.allowedIpsText"
          placeholder="allowedIps (optional, comma-separated)"
          class="border rounded px-3 py-1.5 text-sm md:col-span-2"
        />
        <button class="px-3 py-1.5 rounded-md bg-emerald-600 text-white text-sm md:col-span-2" :disabled="state.creating">
          Create + mark pending ({{ state.track }})
        </button>
      </form>
      <p v-if="state.createError" class="text-sm text-red-600 mb-2">{{ state.createError }}</p>

      <p v-if="state.loading" class="text-sm text-slate-500">Loading...</p>
      <ul v-else-if="state.seeds.length" class="space-y-3">
        <li v-for="row in state.seeds" :key="row.id" class="rounded-lg border bg-slate-50 p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="space-y-1">
              <p class="font-mono text-sm">
                <span class="font-semibold">{{ row.clientId }}</span>
                <span class="text-slate-400"> &middot; track={{ row.track }} &middot; </span>
                <span :class="statusClass(row.status)">{{ row.status }}</span>
                <span class="text-slate-400"> &middot; attempts={{ row.attemptCount }}</span>
              </p>
              <p class="text-xs text-slate-500">
                secret: {{ row.secret ? "(plain pending)" : "(cleared)" }} &middot; reason: {{ row.reason ?? "-" }} &middot;
                lastSync: {{ row.lastSyncedAt ?? "-" }}
              </p>
              <p class="text-xs">
                targets: <span v-for="t in row.targets" :key="t" class="bg-slate-200 px-1 rounded mr-1">{{ t }}</span>
              </p>
            </div>
            <div class="flex gap-2">
              <button class="text-xs bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded" @click="toggleDeliveryStates(row.id)">
                {{ state.opened[row.id] ? "Hide" : "Show" }} delivery states
              </button>
              <button class="text-xs bg-red-600 text-white px-2 py-1 rounded" @click="removeSeed(row)">Delete</button>
            </div>
          </div>
          <div v-if="state.opened[row.id]" class="mt-3 bg-white border rounded p-2">
            <table class="w-full text-xs">
              <thead>
                <tr class="text-left text-slate-500 border-b">
                  <th class="py-1 pr-2">target</th>
                  <th class="py-1 pr-2">state</th>
                  <th class="py-1 pr-2">attempts</th>
                  <th class="py-1 pr-2">lastAttemptAt</th>
                  <th class="py-1 pr-2">lastDeliveredAt</th>
                  <th class="py-1 pr-2">reason</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="dr in state.deliveryStates[row.id] ?? []" :key="dr.target" class="border-b last:border-b-0">
                  <td class="py-1 pr-2 font-mono">{{ dr.target }}</td>
                  <td class="py-1 pr-2" :class="stateClass(dr.state)">{{ dr.state }}</td>
                  <td class="py-1 pr-2">{{ dr.attemptCount }}</td>
                  <td class="py-1 pr-2">{{ dr.lastAttemptAt ?? "-" }}</td>
                  <td class="py-1 pr-2">{{ dr.lastDeliveredAt ?? "-" }}</td>
                  <td class="py-1 pr-2">{{ dr.reason ?? "-" }}</td>
                </tr>
                <tr v-if="!(state.deliveryStates[row.id] ?? []).length">
                  <td colspan="6" class="py-2 text-center text-slate-400">no cursor yet</td>
                </tr>
              </tbody>
            </table>
          </div>
        </li>
      </ul>
      <p v-else class="text-sm text-slate-500">No data-plane seed on track={{ state.track }}.</p>
    </section>
  </div>
</template>

<script setup lang="ts">
interface PropKeyTargetRow {
  target: string;
  state: string;
  reason: string | null;
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
  attemptCount: number;
}

interface DataPlaneRow {
  id: string;
  clientId: string;
  track: "http" | "message";
  secret: string | null;
  targets: string[];
  allowedIps: string[] | null;
  status: string;
  reason: string | null;
  lastSyncedAt: string | null;
  attemptCount: number;
}

interface DeliveryStateRow {
  target: string;
  state: string;
  reason: string | null;
  lastAttemptAt: string | null;
  lastDeliveredAt: string | null;
  attemptCount: number;
}

const state = reactive({
  loading: false,
  syncing: false,
  creating: false,
  createError: "",
  track: "http" as "http" | "message",
  propKeyTargets: [] as PropKeyTargetRow[],
  propKeySaving: false,
  propKeyError: "",
  seeds: [] as DataPlaneRow[],
  opened: {} as Record<string, boolean>,
  deliveryStates: {} as Record<string, DeliveryStateRow[]>,
});

const newPropKeyTarget = ref("");
const newSeed = reactive({
  clientId: "",
  secret: "",
  targetsText: "http://api_a:3000,http://api_b:3000,http://api_c:3000,http://app_d:3000,http://app_e:3000",
  allowedIpsText: "",
});

function statusClass(status: string) {
  if (status === "ok") return "text-emerald-600 font-semibold";
  if (status === "pending" || status === "delete_pending") return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}
function stateClass(s: string) {
  if (s === "delivered") return "text-emerald-600 font-semibold";
  if (s === "pending") return "text-amber-600 font-semibold";
  return "text-red-600 font-semibold";
}

async function loadAll() {
  state.loading = true;
  try {
    const [propRes, seedsRes] = await Promise.all([
      $fetch<{ ok: boolean; rows: PropKeyTargetRow[] }>("/api/admin/propagation-key/targets"),
      $fetch<{ ok: boolean; rows: DataPlaneRow[] }>(`/api/admin/data-plane?track=${state.track}`),
    ]);
    state.propKeyTargets = propRes.rows ?? [];
    state.seeds = seedsRes.rows ?? [];
    for (const id of Object.keys(state.opened)) {
      if (state.opened[id]) await fetchDeliveryStates(id);
    }
  } finally {
    state.loading = false;
  }
}

async function syncNow() {
  state.syncing = true;
  try {
    await $fetch(`/api/admin/sync?track=${state.track}`, { method: "POST" });
    await loadAll();
  } finally {
    state.syncing = false;
  }
}

async function addPropKeyTarget() {
  const target = newPropKeyTarget.value.trim();
  if (!target) return;
  state.propKeySaving = true;
  state.propKeyError = "";
  try {
    const result = await $fetch<{ ok: boolean; error?: string }>("/api/admin/propagation-key/targets", {
      method: "POST",
      body: { target },
    });
    if (!result.ok) state.propKeyError = result.error ?? "add failed";
    else newPropKeyTarget.value = "";
    await loadAll();
  } finally {
    state.propKeySaving = false;
  }
}

async function createSeed() {
  state.creating = true;
  state.createError = "";
  try {
    const body = {
      clientId: newSeed.clientId.trim(),
      secret: newSeed.secret,
      targets: newSeed.targetsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      allowedIps: newSeed.allowedIpsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      track: state.track,
    };
    const result = await $fetch<{ ok: boolean; error?: string }>(`/api/admin/data-plane?track=${state.track}`, {
      method: "POST",
      body,
    });
    if (!result.ok) state.createError = result.error ?? "create failed";
    else {
      newSeed.clientId = "";
      newSeed.secret = "";
      newSeed.allowedIpsText = "";
      await loadAll();
    }
  } finally {
    state.creating = false;
  }
}

async function removeSeed(row: DataPlaneRow) {
  if (!confirm(`Delete ${row.clientId} (${row.track})?`)) return;
  await $fetch(`/api/admin/data-plane/${row.id}`, { method: "DELETE" });
  await loadAll();
}

async function toggleDeliveryStates(id: string) {
  if (state.opened[id]) {
    state.opened[id] = false;
    return;
  }
  state.opened[id] = true;
  await fetchDeliveryStates(id);
}

async function fetchDeliveryStates(id: string) {
  const res = await $fetch<{ ok: boolean; states: DeliveryStateRow[] }>(`/api/admin/data-plane/${id}/delivery-states`);
  state.deliveryStates[id] = res.states ?? [];
}

await loadAll();
</script>
