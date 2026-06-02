import { defineEventHandler, getRouterParam } from "h3";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id") ?? "";
  const config = useRuntimeConfig();
  const response = await fetch(`${config.adminApiABase as string}/admin/rows/${id}`, {
    method: "DELETE",
  });
  return response.json();
});
