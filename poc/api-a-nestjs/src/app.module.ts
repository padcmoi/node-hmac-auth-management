import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { TypeOrmModule, getDataSourceToken } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { HmacHttpSeedEntity } from "./entities/hmac-http-seed.entity";
import { HmacHttpSeedDeliveryStateEntity } from "./entities/hmac-http-seed-delivery-state.entity";
import { HmacAuthService } from "./hmac-auth.service";
import { HmacAuthManagementService } from "./hmac-auth-management.service";
import { HmacSyncScheduler } from "./hmac-sync.scheduler";
import { HmacInternalManagementMiddleware, HmacVerifyHttpRequestMiddleware, PermissiveCorsMiddleware } from "./hmac.middlewares";
import { AppController } from "./app.controller";
import { AdminRowsController, AdminDeliveryStatesController, AdminSyncController } from "./admin.controller";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "mariadb",
      host: process.env.MARIADB_HOST ?? "mariadb",
      port: Number(process.env.MARIADB_PORT ?? 3306),
      username: process.env.MARIADB_USER ?? "hmac",
      password: process.env.MARIADB_PASSWORD ?? "hmacpwd",
      database: process.env.MARIADB_DATABASE ?? "hmac_mgmt",
      entities: [HmacHttpSeedEntity, HmacHttpSeedDeliveryStateEntity],
      synchronize: true,
      logging: false,
    }),
    TypeOrmModule.forFeature([HmacHttpSeedEntity, HmacHttpSeedDeliveryStateEntity]),
  ],
  controllers: [AppController, AdminRowsController, AdminDeliveryStatesController, AdminSyncController],
  providers: [
    {
      provide: HmacAuthService,
      useFactory: () => HmacAuthService.build(),
    },
    {
      provide: HmacAuthManagementService,
      inject: [HmacAuthService, getDataSourceToken()],
      useFactory: (authService: HmacAuthService, dataSource: DataSource) =>
        HmacAuthManagementService.build(authService, dataSource),
    },
    HmacInternalManagementMiddleware,
    HmacVerifyHttpRequestMiddleware,
    PermissiveCorsMiddleware,
    HmacSyncScheduler,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(PermissiveCorsMiddleware).forRoutes("*path");
    consumer
      .apply(HmacInternalManagementMiddleware)
      .forRoutes(process.env.HMAC_INTERNAL_MANAGEMENT_ROUTE ?? "/api/internal/hmac");
    consumer.apply(HmacVerifyHttpRequestMiddleware).forRoutes("secure/{*path}");
  }
}
