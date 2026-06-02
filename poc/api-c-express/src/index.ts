import express from "express";
import { captureRawBody } from "@naskot/node-hmac-auth";
import { buildHmacAuthService } from "./hmac-auth.service";

async function bootstrap() {
  const hmacAuthService = await buildHmacAuthService();

  const app = express();
  app.set("trust proxy", true);
  app.use(
    express.json({
      verify: (req, _res, buf) => captureRawBody(req as unknown as { rawBody?: Buffer }, _res, buf),
    })
  );

  // `express.json({ verify })` only fires on requests that carry a body.
  // For GET / DELETE without payload, `req.rawBody` stays undefined and the
  // upstream lib's middleware falls back to `req.body`, which Express sets
  // to `{}` for any application/json-typed request -> the server signs
  // `JSON.stringify({}) === "{}"` while the client signed `""`. Mismatch.
  // Force an empty buffer so both sides agree on `hash("")`.
  app.use((req: any, _res, next) => {
    if (!req.rawBody) req.rawBody = Buffer.alloc(0);
    next();
  });

  app.use(hmacAuthService.auth.createExpressInternalManagementMiddleware());
  app.use("/secure", hmacAuthService.auth.verifyHttpRequest);

  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: process.env.SERVICE_NAME ?? "api_c_express" });
  });

  app.post("/secure/business", (req: any, res) => {
    res.json({
      ok: true,
      service: process.env.SERVICE_NAME ?? "api_c_express",
      authenticatedAs: req.hmacAuth?.clientId ?? null,
      message: "Hello signed visitor; you reached api_c_express business route",
    });
  });

  app.get("/secure/credentials/local", async (req: any, res) => {
    const clientIds = await hmacAuthService.listClientIds();
    res.json({
      ok: true,
      service: process.env.SERVICE_NAME ?? "api_c_express",
      authenticatedAs: req.hmacAuth?.clientId ?? null,
      clientIds,
    });
  });

  const port = Number(process.env.PORT ?? 3000);
  app.listen(port, "0.0.0.0", () => {
    console.info(`[api_c] listening on :${port}`);
  });
}

void bootstrap();
