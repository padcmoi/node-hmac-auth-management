import tailwindcss from "@tailwindcss/vite";

// Nuxt 4 configuration. Tailwind v4 is plugged in via its official Vite
// integration (no postcss config, no tailwind.config.js needed for a
// vanilla setup). Server-only env vars stay in the private runtimeConfig
// scope; the browser only receives `runtimeConfig.public.*`.
export default defineNuxtConfig({
  compatibilityDate: "2025-01-01",
  devtools: { enabled: false },
  css: ["~/assets/css/tailwind.css"],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    redisUrl: process.env.REDIS_URL ?? "redis://redis_d:6379",
    hmacNamespace: process.env.HMAC_NAMESPACE ?? "app_d",
    hmacSecretToken: process.env.HMAC_SECRET_TOKEN ?? "token_delta_D",
    hmacInternalManagementRoute: process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac",
    hmacPropagationKey: process.env.HMAC_PROPAGATION_KEY ?? "self_propagation_signer",
    signingClientId: process.env.SIGNING_CLIENT_ID ?? "client_consumer_d",
    peerApiA: process.env.PEER_API_A ?? "http://api_a:3000",
    peerApiB: process.env.PEER_API_B ?? "http://api_b:3000",
    peerApiC: process.env.PEER_API_C ?? "http://api_c:3000",
    peerAppE: process.env.PEER_APP_E ?? "http://app_e:3000",
    adminApiABase: process.env.ADMIN_API_A_BASE ?? "http://api_a:3000",
    serviceName: process.env.SERVICE_NAME ?? "app_d_nuxt",
    public: {
      serviceName: process.env.SERVICE_NAME ?? "app_d_nuxt",
      framework: "Nuxt 4",
      peers: ["api_a", "api_b", "api_c", "app_e"],
    },
  },
});
