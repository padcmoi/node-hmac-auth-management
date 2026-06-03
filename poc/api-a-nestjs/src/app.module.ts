import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { TypeOrmModule, getDataSourceToken } from "@nestjs/typeorm";
import type { DataSource } from "typeorm";
import { HmacHttpPropagationKeyTargetEntity } from "./entities/hmac-http-propagation-key-target.entity";
import { HmacDataPlaneSeedEntity } from "./entities/hmac-data-plane-seed.entity";
import { HmacDataPlaneDeliveryStateEntity } from "./entities/hmac-data-plane-delivery-state.entity";
import { HmacAuthService } from "./hmac-auth.service";
import { HmacAuthManagementService } from "./hmac-auth-management.service";
import { HmacSyncScheduler } from "./hmac-sync.scheduler";
import { HmacInternalManagementMiddleware, HmacVerifyHttpRequestMiddleware, PermissiveCorsMiddleware } from "./hmac.middlewares";
import { AppController } from "./app.controller";
import { AdminPropagationKeyTargetsController, AdminDataPlaneController, AdminSyncController } from "./admin.controller";

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: "mariadb",
      host: process.env.MARIADB_HOST ?? "mariadb",
      port: Number(process.env.MARIADB_PORT ?? 3306),
      username: process.env.MARIADB_USER ?? "hmac",
      password: process.env.MARIADB_PASSWORD ?? "hmacpwd",
      database: process.env.MARIADB_DATABASE ?? "hmac_mgmt",
      entities: [HmacHttpPropagationKeyTargetEntity, HmacDataPlaneSeedEntity, HmacDataPlaneDeliveryStateEntity],
      synchronize: true,
      logging: false,
    }),
    TypeOrmModule.forFeature([HmacHttpPropagationKeyTargetEntity, HmacDataPlaneSeedEntity, HmacDataPlaneDeliveryStateEntity]),
  ],
  controllers: [AppController, AdminPropagationKeyTargetsController, AdminDataPlaneController, AdminSyncController],
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
