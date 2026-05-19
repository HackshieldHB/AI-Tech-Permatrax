import { Module, forwardRef } from '@nestjs/common'; // FIX
import { BakController, PermitClusterBakFormController } from './bak.controller'; // FIX
import { BakAgreementService } from './bak.service'; // FIX
import { CompensationModule } from '../compensation/compensation.module'; // FIX
import { SignatureModule } from '../signature/signature.module'; // FIX
import { PrismaModule } from '../prisma/prisma.module'; // FIX
import { StorageModule } from '../storage/storage.module'; // FIX
import { NotificationsModule } from '../notifications/notifications.module'; // FIX
import { PermitClusterModule } from '../permit-cluster/permit-cluster.module'; // FIX
import { BakpModule } from '../bakp/bakp.module'; // FIX: auto-init BAKP after BAK Agreement admin approve

@Module({
  imports: [
    CompensationModule, // FIX
    SignatureModule, // FIX
    PrismaModule, // FIX
    StorageModule, // FIX
    NotificationsModule, // FIX
    forwardRef(() => PermitClusterModule), // FIX: BakAgreementService → PermitClusterService
    BakpModule, // FIX: BakAgreementService → BakpService.initBakp
  ],
  controllers: [BakController, PermitClusterBakFormController], // FIX
  providers: [BakAgreementService], // FIX
})
export class BakModule {}
