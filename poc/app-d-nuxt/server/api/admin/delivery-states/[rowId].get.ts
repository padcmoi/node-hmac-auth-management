import { defineEventHandler, getRouterParam } from "h3";

export default defineEventHandler(async (event) => {
  const rowId = getRouterParam(event, "rowId") ?? "";
  const config = useRuntimeConfig();
  const response = await fetch(`${config.adminApiABase as string}/admin/delivery-states/${rowId}`);
  return response.json();
});
