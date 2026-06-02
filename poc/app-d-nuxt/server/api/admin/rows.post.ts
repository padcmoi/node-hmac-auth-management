import { defineEventHandler, readBody } from "h3";

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const body = await readBody(event);
  const response = await fetch(`${config.adminApiABase as string}/admin/rows`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
});
