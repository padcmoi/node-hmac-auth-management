import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { AppController } from "./app.controller";
import { HmacAuthService } from "./hmac-auth.service";
import { HmacInternalManagementMiddleware, HmacVerifyHttpRequestMiddleware } from "./hmac.middlewares";

@Module({
  controllers: [AppController],
  providers: [
    {
      provide: HmacAuthService,
      useFactory: () => HmacAuthService.build(),
    },
    HmacInternalManagementMiddleware,
    HmacVerifyHttpRequestMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(HmacInternalManagementMiddleware)
      .forRoutes(process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac");
    consumer.apply(HmacVerifyHttpRequestMiddleware).forRoutes("secure/{*path}");
  }
}
