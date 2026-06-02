import { defineEventHandler } from "h3";

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const response = await fetch(`${config.adminApiABase as string}/admin/sync`, { method: "POST" });
  return response.json();
});
