import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    rawBody: true,
  });
  app.set("trust proxy", true);
  app.useBodyParser("json");
  // Defensive: ensure `req.rawBody` is set (empty Buffer) for body-less
  // verbs (GET, DELETE, ...) so the upstream lib's signature verify
  // hashes `""` on both sides. Without this, the lib falls back to
  // `req.body` (an empty `{}` set by JSON parsing) and signs
  // `JSON.stringify({}) === "{}"` server-side while the client signed
  // `""`. Same gotcha as the Express POC.
  app.use((req: any, _res: any, next: any) => {
    if (!req.rawBody) req.rawBody = Buffer.alloc(0);
    next();
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, "0.0.0.0");
  console.info(`[api_b] listening on :${port}`);
}

void bootstrap();
