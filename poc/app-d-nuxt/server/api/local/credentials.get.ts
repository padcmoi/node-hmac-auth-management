import { defineEventHandler } from "h3";
import { getHmacAuthService } from "../../utils/hmac-auth.service";

export default defineEventHandler(async () => {
  const runtime = await getHmacAuthService();
  const clientIds = await runtime.auth.clients.listClientIds();
  return {
    service: useRuntimeConfig().serviceName,
    clientIds,
  };
});
