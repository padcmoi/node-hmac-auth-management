import { defineEventHandler, getRouterParam, readBody } from "h3";

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id") ?? "";
  const config = useRuntimeConfig();
  const body = await readBody(event);
  const response = await fetch(`${config.adminApiABase as string}/admin/rows/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
});
