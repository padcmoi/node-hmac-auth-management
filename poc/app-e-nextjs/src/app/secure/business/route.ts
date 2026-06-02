import { NextResponse, type NextRequest } from "next/server";
import { getHmacAuthService, config } from "@/server/hmac-auth.service";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const runtime = await getHmacAuthService();
  const headers: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const rawBody = await req.text();
  const url = new URL(req.url);
  try {
    const verified = await runtime.auth.verifyHttpSignature({
      method: "POST",
      path: `${url.pathname}${url.search}`,
      headers,
      rawBody,
      now: Date.now(),
    });
    return NextResponse.json({
      ok: true,
      service: config.serviceName(),
      authenticatedAs: verified.clientId,
      message: "Hello signed visitor; you reached app_e_nextjs business route",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.code ?? "UNAUTHORIZED", message: error?.message ?? "verify failed" },
      { status: error?.status ?? 401 }
    );
  }
}
