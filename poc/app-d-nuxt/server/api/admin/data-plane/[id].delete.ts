import { defineEventHandler, getRouterParam } from "h3";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const id = getRouterParam(event, "id");
  const response = await fetch(`${config.adminApiABase as string}/admin/data-plane/${id}`, {
    method: "DELETE",
  });
  return response.json();
});
