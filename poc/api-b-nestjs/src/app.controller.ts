import { Controller, Get, Post, Req } from "@nestjs/common";
import { HmacAuthService } from "./hmac-auth.service";

@Controller()
export class AppController {
  constructor(private readonly authService: HmacAuthService) {}

  @Get("health")
  health() {
    return { ok: true, service: process.env.SERVICE_NAME ?? "api_b_nestjs" };
  }

  @Post("secure/business")
  business(@Req() req: any) {
    return {
      ok: true,
      service: process.env.SERVICE_NAME ?? "api_b_nestjs",
      authenticatedAs: req.hmacAuth?.clientId ?? null,
      message: "Hello signed visitor; you reached api_b_nestjs business route",
    };
  }

  @Get("secure/credentials/local")
  async credentialsLocal(@Req() req: any) {
    const clientIds = await this.authService.listClientIds();
    return {
      ok: true,
      service: process.env.SERVICE_NAME ?? "api_b_nestjs",
      authenticatedAs: req.hmacAuth?.clientId ?? null,
      clientIds,
    };
  }
}
