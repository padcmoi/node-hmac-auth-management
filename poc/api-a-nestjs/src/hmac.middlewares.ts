import { Injectable, type NestMiddleware } from "@nestjs/common";
import { HmacAuthService } from "./hmac-auth.service";

/**
 * NestJS-idiomatic adapters around the upstream Express-compatible
 * middlewares. They are bound on routes by `app.module.ts`'s
 * `configure(MiddlewareConsumer)`. No raw `app.use(...)` calls are
 * needed at bootstrap time.
 */

@Injectable()
export class HmacInternalManagementMiddleware implements NestMiddleware {
  private readonly middleware: (req: unknown, res: unknown, next: () => void) => Promise<void>;

  constructor(authService: HmacAuthService) {
    this.middleware = authService.auth.createInternalManagementMiddleware() as never;
  }

  use(req: unknown, res: unknown, next: () => void) {
    return this.middleware(req, res, next);
  }
}

@Injectable()
export class HmacVerifyHttpRequestMiddleware implements NestMiddleware {
  private readonly middleware: (req: unknown, res: unknown, next: () => void) => Promise<void>;

  constructor(authService: HmacAuthService) {
    this.middleware = authService.auth.verifyHttpRequest as never;
  }

  use(req: unknown, res: unknown, next: () => void) {
    return this.middleware(req, res, next);
  }
}

/**
 * Permissive CORS for the POC so the Nuxt admin UI (different origin
 * from the browser perspective) can hit api_a's admin endpoints with no
 * pre-flight friction. NOT production code.
 */
@Injectable()
export class PermissiveCorsMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }
    next();
  }
}
