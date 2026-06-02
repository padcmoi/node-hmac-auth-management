<template>
  <div class="min-h-screen bg-slate-50 text-slate-900">
    <header class="border-b bg-white">
      <div class="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold">{{ config.public.framework }} - {{ config.public.serviceName }}</h1>
          <p class="text-sm text-slate-500">Frontend integrating @naskot/node-hmac-auth + @naskot/node-hmac-auth-management</p>
        </div>
        <nav class="flex gap-3 text-sm">
          <NuxtLink
            to="/"
            class="px-3 py-1.5 rounded-md border bg-white hover:bg-slate-100"
            active-class="bg-slate-900 text-white border-slate-900"
            >Peers</NuxtLink
          >
          <NuxtLink
            to="/admin"
            class="px-3 py-1.5 rounded-md border bg-white hover:bg-slate-100"
            active-class="bg-slate-900 text-white border-slate-900"
            >Admin api_a (DB)</NuxtLink
          >
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-6 py-8">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const config = useRuntimeConfig();
</script>
