import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageController } from './storage.controller'; // FIX: expose local upload endpoints

@Global()
@Module({
  controllers: [StorageController], // FIX: register storage controller
  providers: [StorageService],
  exports: [StorageService]
})
export class StorageModule {}
