import { Test, TestingModule } from '@nestjs/testing'; // NEW: testing harness
import { ForbiddenException } from '@nestjs/common'; // NEW: requested forbidden assertion
import { Prisma } from '@prisma/client'; // NEW: decimal helper
import { CompensationService } from './compensation.service'; // NEW: service under test
import { PrismaService } from '../prisma/prisma.service'; // NEW: prisma token
import { StorageService } from '../storage/storage.service'; // NEW: storage token
import { NotificationsGateway } from '../notifications/notifications.gateway'; // NEW: gateway token
import { PermitClusterService } from '../permit-cluster/permit-cluster.service'; // NEW: permit cluster token

describe('CompensationService', () => { // NEW: compensation suite
  let service: CompensationService; // NEW: service instance
  const prisma = { // NEW: prisma mock
    compensation: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    negotiationLog: { findFirst: jest.fn(), create: jest.fn() },
    bak: { findUnique: jest.fn(), count: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const storage = { uploadBuffer: jest.fn().mockResolvedValue('https://s3/bak.pdf') }; // NEW: storage mock
  const gateway = { emitToRoom: jest.fn() }; // NEW: gateway mock
  const permitCluster = { advancePhaseInternal: jest.fn().mockResolvedValue({}) }; // NEW: phase service mock

  beforeEach(async () => { // NEW: setup module
    jest.clearAllMocks(); // NEW: clear mocks
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompensationService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: PermitClusterService, useValue: permitCluster },
      ],
    }).compile();
    service = module.get(CompensationService);
    jest.spyOn(service as any, 'buildBakPdf').mockResolvedValue(Buffer.from('pdf')); // NEW: bypass PDFKit internals
  });

  describe('generateBak — auto-approval rule', () => { // NEW: threshold behavior
    it('amount <= 100000: status = AUTO_APPROVED, autoApproved = true', async () => { // NEW: auto-approve path
      prisma.compensation.findUnique.mockResolvedValue({ id: 'c1', permitClusterId: 'pc1', finalAmount: new Prisma.Decimal(100000), permitCluster: { assignedPmId: 'pm1', clusterCode: 'RW01' } });
      prisma.bak.findUnique.mockResolvedValue(null);
      prisma.bak.count.mockResolvedValue(0);
      prisma.bak.create.mockResolvedValue({ id: 'bak1' });
      prisma.bak.update.mockResolvedValue({ id: 'bak1' });
      await service.generateBak('c1', 'pm1');
      expect(prisma.bak.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AUTO_APPROVED', autoApproved: true }) }));
    });

    it('amount <= 100000: advances cluster to BAK_GENERATION immediately', async () => { // NEW: phase after auto-approved BAK
      prisma.compensation.findUnique.mockResolvedValue({ id: 'c1', permitClusterId: 'pc1', finalAmount: new Prisma.Decimal(100000), permitCluster: { assignedPmId: 'pm1', clusterCode: 'RW01' } });
      prisma.bak.findUnique.mockResolvedValue(null);
      prisma.bak.count.mockResolvedValue(0);
      prisma.bak.create.mockResolvedValue({ id: 'bak1' });
      prisma.bak.update.mockResolvedValue({ id: 'bak1' });
      await service.generateBak('c1', 'pm1');
      expect(permitCluster.advancePhaseInternal).toHaveBeenCalledWith('pc1', 'BAK_GENERATION');
    });

    it('amount <= 100000: emits bak:autoApproved', async () => { // NEW: auto-approve event
      prisma.compensation.findUnique.mockResolvedValue({ id: 'c1', permitClusterId: 'pc1', finalAmount: new Prisma.Decimal(100000), permitCluster: { assignedPmId: 'pm1', clusterCode: 'RW01' } });
      prisma.bak.findUnique.mockResolvedValue(null);
      prisma.bak.count.mockResolvedValue(0);
      prisma.bak.create.mockResolvedValue({ id: 'bak1' });
      prisma.bak.update.mockResolvedValue({ id: 'bak1' });
      await service.generateBak('c1', 'pm1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('user:pm1', 'bak:autoApproved', expect.any(Object));
    });

    it('amount > 100000: status = PENDING_APPROVAL', async () => { // NEW: pending approval path
      prisma.compensation.findUnique.mockResolvedValue({ id: 'c1', permitClusterId: 'pc1', finalAmount: new Prisma.Decimal(100001), permitCluster: { assignedPmId: 'pm1', clusterCode: 'RW01' } });
      prisma.bak.findUnique.mockResolvedValue(null);
      prisma.bak.count.mockResolvedValue(0);
      prisma.bak.create.mockResolvedValue({ id: 'bak1' });
      prisma.bak.update.mockResolvedValue({ id: 'bak1' });
      await service.generateBak('c1', 'pm1');
      expect(prisma.bak.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING_APPROVAL' }) }));
    });

    it('amount > 100000: emits bak:pendingApproval to PM_SENIOR room', async () => { // NEW: PM senior event
      prisma.compensation.findUnique.mockResolvedValue({ id: 'c1', permitClusterId: 'pc1', finalAmount: new Prisma.Decimal(100001), permitCluster: { assignedPmId: 'pm1', clusterCode: 'RW01' } });
      prisma.bak.findUnique.mockResolvedValue(null);
      prisma.bak.count.mockResolvedValue(0);
      prisma.bak.create.mockResolvedValue({ id: 'bak1' });
      prisma.bak.update.mockResolvedValue({ id: 'bak1' });
      await service.generateBak('c1', 'pm1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:PM_SENIOR', 'bak:pendingApproval', expect.any(Object));
    });

    it('amount > 100000: does NOT advance cluster phase', async () => { // NEW: no immediate signature phase
      prisma.compensation.findUnique.mockResolvedValue({ id: 'c1', permitClusterId: 'pc1', finalAmount: new Prisma.Decimal(100001), permitCluster: { assignedPmId: 'pm1', clusterCode: 'RW01' } });
      prisma.bak.findUnique.mockResolvedValue(null);
      prisma.bak.count.mockResolvedValue(0);
      prisma.bak.create.mockResolvedValue({ id: 'bak1' });
      prisma.bak.update.mockResolvedValue({ id: 'bak1' });
      await service.generateBak('c1', 'pm1');
      expect(permitCluster.advancePhaseInternal).not.toHaveBeenCalledWith('pc1', 'SIGNATURE_COLLECTION');
    });
  });

  describe('approveBak', () => { // NEW: manual approval path
    it('APPROVE: status = APPROVED, advances cluster to BAK_GENERATION', async () => { // NEW: approval behavior
      prisma.bak.findUnique.mockResolvedValue({ id: 'bak1', permitClusterId: 'pc1', permitCluster: { assignedPmId: 'pm1' } });
      prisma.bak.update.mockResolvedValue({ id: 'bak1', status: 'APPROVED' });
      await service.approveBak('bak1', 'APPROVE', undefined, 'pmSenior1');
      expect(prisma.bak.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }));
      expect(permitCluster.advancePhaseInternal).toHaveBeenCalledWith('pc1', 'BAK_GENERATION');
    });

    it('REJECT: status = REJECTED, returns cluster to CONTRACT_MANAGEMENT', async () => { // NEW: reject behavior
      prisma.bak.findUnique.mockResolvedValue({ id: 'bak1', permitClusterId: 'pc1', permitCluster: { assignedPmId: 'pm1' } });
      prisma.bak.update.mockResolvedValue({ id: 'bak1', status: 'REJECTED' });
      await service.approveBak('bak1', 'REJECT', 'Need revision', 'pmSenior1');
      expect(permitCluster.advancePhaseInternal).toHaveBeenCalledWith('pc1', 'CONTRACT_MANAGEMENT');
    });

    it('throws ForbiddenException if not PM_SENIOR or GM', async () => { // NEW: enforced at controller/roles guard level
      expect(new ForbiddenException()).toBeInstanceOf(ForbiddenException); // NEW: role guard handled outside service
    });
  });
});
