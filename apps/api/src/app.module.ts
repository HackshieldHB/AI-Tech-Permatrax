import { Module, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor'; // FIX: register globally
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsModule } from './projects/projects.module';
import { MapModule } from './map/map.module';
import { BullModule } from '@nestjs/bull';
import { bullRedisOptionsFromUrl } from './redis/bull-redis.util';
import { MailModule } from './mail/mail.module';
import { RequestsModule } from './requests/requests.module';
import { SlaModule } from './sla/sla.module';
import { StorageModule } from './storage/storage.module';
import { DocumentsModule } from './documents/documents.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RedisModule } from './redis/redis.module'; // FIX: Globals first before auth
import { AuthModule } from './auth/auth.module';
import { ClusterModule } from './cluster/cluster.module';
import { SurveyModule } from './survey/survey.module';
import { ReportModule } from './report/report.module';
import { validateEnv } from './config/env.config';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { CleanListModule } from './clean-list/clean-list.module'; // NEW
import { VisitRequestModule } from './visit-request/visit-request.module'; // NEW
import { BaOpenModule } from './ba-open/ba-open.module'; // NEW
import { IspCustomerModule } from './isp-customer/isp-customer.module'; // NEW
import { StockModule } from './stock/stock.module';
import { OrderModule } from './order/order.module';
import { SuratJalanModule } from './surat-jalan/surat-jalan.module';
import { PurchaseRequestModule } from './purchase-request/purchase-request.module';
import { UserModule } from './user/user.module';
import { FeatureFlagModule } from './feature-flag/feature-flag.module';
import { AuditLogModule } from './audit-log/audit-log.module';
import { PermitClusterModule } from './permit-cluster/permit-cluster.module';
import { ApdAbdModule } from './apd-abd/apd-abd.module';
import { SocializationModule } from './socialization/socialization.module';
import { CompensationModule } from './compensation/compensation.module';
import { SignatureModule } from './signature/signature.module';
import { BakModule } from './bak/bak.module';
import { ScomModule } from './scom/scom.module';
import { BakpModule } from './bakp/bakp.module';
import { DocumentListModule } from './document-list/document-list.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { DesignModule } from './design/design.module';
import { HealthModule } from './health/health.module';
import { CashOperationModule } from './cash-operation/cash-operation.module';
import { CashOpRealisasiModule } from './cash-op-realisasi/cash-op-realisasi.module';
import { SurveyDataModule } from './survey-data/survey-data.module'; // NEW
import { BaSurveyModule } from './ba-survey/ba-survey.module'; // NEW
import { SipModule } from './sip/sip.module'; // NEW
import { HldModule } from './hld/hld.module'; // NEW
import { LldModule } from './lld/lld.module'; // NEW
import { PrBrModule } from './pr-br/pr-br.module'; // NEW
import { ContractModule } from './contract/contract.module'; // NEW
import { SkomBudgetModule } from './skom-budget/skom-budget.module'; // NEW
import { ClaimPackageModule } from './claim-package/claim-package.module'; // NEW
import { InvoicePackageModule } from './invoice-package/invoice-package.module'; // NEW
import { SurveyorDocPackageModule } from './surveyor-doc-package/surveyor-doc-package.module'; // NEW: phase 7 doc package module
import { IspEmailModule } from './isp-email/isp-email.module'; // NEW: ISP email config/send module
import { CommonModule } from './common/common.module'; // FIX: global HMAC download-token service
import { BudgetLedgerModule } from './budget-ledger/budget-ledger.module';
import { FinanceProjectModule } from './finance-project/finance-project.module';
import { BudgetTransferModule } from './budget-transfer/budget-transfer.module';
import { FinanceForecastModule } from './finance-forecast/finance-forecast.module';
import { FinanceReportModule } from './finance-report/finance-report.module';
import { SupplierModule } from './supplier/supplier.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { ProcurementMailModule } from './procurement-mail/procurement-mail.module';
import { PoGenerationModule } from './po-generation/po-generation.module';
import { SupplierInvoiceModule } from './supplier-invoice/supplier-invoice.module';
import { StockOutModule } from './stock-out/stock-out.module';
import { PipelineEngineModule } from './pipeline-engine/pipeline-engine.module'; // NEW: Phase 3A
import { FtttProjectModule } from './fttt-project/fttt-project.module'; // FTTT flow
import { DailyActivityModule } from './daily-activity/daily-activity.module'; // NEW: Integra V1 Daily Activity
import { AppController } from './app.controller'; // FIX: root + live probes

@Module({
  imports: [
    ConfigModule.forRoot({
      envFilePath: '../../.env',
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRoot([{
      name: 'global',
      ttl: 60000,   // 60 seconds window
      limit: 100,   // 100 requests per window globally
    }]),
    BullModule.forRootAsync({
      useFactory: () => ({
        redis: {
          ...bullRedisOptionsFromUrl(process.env.REDIS_URL || 'redis://localhost:6379'),
          // FIX: retry strategy so Bull queues survive a transient Redis outage at boot
          // instead of crashing the entire application.
          retryStrategy: (times: number) => Math.min(times * 200, 5000),
          reconnectOnError: () => true,
        },
      }),
    }),
    MailModule,
    RedisModule, // FIX: Early initialization
    CommonModule, // FIX: global download-token + other shared services
    PrismaModule, 
    ProjectsModule, 
    MapModule,
    RequestsModule,
    SlaModule,
    StorageModule,
    DocumentsModule,
    NotificationsModule,
    AuthModule,
    ClusterModule,
    SurveyModule,
    ReportModule,
    CleanListModule,    // NEW: Phase 2
    VisitRequestModule, // NEW: Phase 2
    BaOpenModule,       // NEW: Phase 2
    IspCustomerModule,  // NEW: Phase 2
    StockModule,
    SuratJalanModule,
    PurchaseRequestModule,
    OrderModule,
    UserModule,
    FeatureFlagModule,
    AuditLogModule,
    PermitClusterModule,
    ApdAbdModule,
    SocializationModule,
    CompensationModule,
    SignatureModule,
    BakModule,
    ScomModule,
    BakpModule,
    DocumentListModule,
    DashboardModule,
    DesignModule,
    HealthModule,
    CashOperationModule,
    CashOpRealisasiModule,
    SurveyDataModule, // NEW
    BaSurveyModule, // NEW
    SipModule, // NEW
    HldModule, // NEW
    LldModule, // NEW
    PrBrModule, // NEW
    ContractModule, // NEW
    SkomBudgetModule, // NEW
    ClaimPackageModule, // NEW
    InvoicePackageModule, // NEW
    SurveyorDocPackageModule, // NEW: surveyor checklist/review flow
    IspEmailModule, // NEW: ISP email settings + send endpoint
    BudgetLedgerModule,
    FinanceProjectModule,
    BudgetTransferModule,
    FinanceForecastModule,
    FinanceReportModule,
    SupplierModule,
    PurchasingModule,
    ProcurementMailModule,
    PoGenerationModule,
    SupplierInvoiceModule,
    StockOutModule,
    FtttProjectModule,
    PipelineEngineModule,
    DailyActivityModule, // NEW: Integra V1 Daily Activity
  ],
  controllers: [AppController], // FIX: register root GET /api (no 404)
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TimeoutInterceptor, // FIX: now registered globally -- 10s timeout on every request
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    }
  ]
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestLoggerMiddleware)
      .forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
