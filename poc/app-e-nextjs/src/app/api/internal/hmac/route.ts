import { NextResponse, type NextRequest } from "next/server";
import { getHmacAuthService } from "@/server/hmac-auth.service";

export const dynamic = "force-dynamic";

async function dispatch(req: NextRequest, method: string) {
  const runtime = await getHmacAuthService();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const rawBody = method === "GET" ? "" : await req.text();
  const url = new URL(req.url);
  const result = await runtime.auth.handleInternalManagementRequest({
    method,
    path: `${url.pathname}${url.search}`,
    headers,
    rawBody,
    now: Date.now(),
  });
  return NextResponse.json(result.body, { status: result.status });
}

export const GET = (req: NextRequest) => dispatch(req, "GET");
export const POST = (req: NextRequest) => dispatch(req, "POST");
export const PUT = (req: NextRequest) => dispatch(req, "PUT");
export const PATCH = (req: NextRequest) => dispatch(req, "PATCH");
export const DELETE = (req: NextRequest) => dispatch(req, "DELETE");
