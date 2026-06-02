import { Injectable, type NestMiddleware } from "@nestjs/common";
import { HmacAuthService } from "./hmac-auth.service";

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
