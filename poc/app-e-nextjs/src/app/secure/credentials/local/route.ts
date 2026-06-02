import { NextResponse, type NextRequest } from "next/server";
import { getHmacAuthService, config } from "@/server/hmac-auth.service";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const runtime = await getHmacAuthService();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const url = new URL(req.url);
  try {
    const verified = await runtime.auth.verifyHttpSignature({
      method: "GET",
      path: `${url.pathname}${url.search}`,
      headers,
      rawBody: "",
      now: Date.now(),
    });
    const clientIds = await runtime.auth.clients.listClientIds();
    return NextResponse.json({
      ok: true,
      service: config.serviceName(),
      authenticatedAs: verified.clientId,
      clientIds,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.code ?? "UNAUTHORIZED", message: error?.message ?? "verify failed" },
      { status: error?.status ?? 401 }
    );
  }
}
