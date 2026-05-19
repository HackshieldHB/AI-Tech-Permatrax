import { Test, TestingModule } from '@nestjs/testing'; // NEW: testing harness
import { PermitClusterService } from './permit-cluster.service'; // NEW: service under test
import { PrismaService } from '../prisma/prisma.service'; // NEW: prisma token
import { NotificationsGateway } from '../notifications/notifications.gateway'; // NEW: gateway token
import { NotificationsService } from '../notifications/notifications.service'; // NEW: TASK notifications on phase advance

describe('PermitClusterService', () => { // NEW: permit cluster suite
  let service: PermitClusterService; // NEW: service instance
  const prisma = { // NEW: prisma mock
    baOpen: { findUnique: jest.fn() },
    permitCluster: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
  const gateway = {
    emitToRoom: jest.fn(),
    emitToRooms: jest.fn(),
    emitToAll: jest.fn(),
    server: {
      emit: jest.fn(),
      to: jest.fn().mockReturnValue({ emit: jest.fn() }),
    },
  }; // NEW: gateway mock (server used by advancePhaseInternal)
  const notifications = { createForUser: jest.fn(), createForRole: jest.fn() }; // NEW: mock notifications

  beforeEach(async () => { // NEW: setup module
    jest.clearAllMocks(); // NEW: clear mocks
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermitClusterService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsGateway, useValue: gateway },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(PermitClusterService);
  });

  describe('createFromBaOpen', () => { // NEW: cluster creation from BA Open
    it('creates PermitCluster with phase SITE_VISIT', async () => { // NEW: initial phase matches permit-flow matrix
      prisma.baOpen.findUnique.mockResolvedValue({ id: 'ba1', visitRequestId: 'vr1', rwCode: 'RW01', ispCustomer: 'Fiber', visitRequest: { assignedPmId: 'pm1', requestedBy: 'sv1', fiberType: 'FTTH', cleanList: { rwCode: 'RW01' } } });
      prisma.permitCluster.findUnique.mockResolvedValue(null);
      prisma.permitCluster.create.mockResolvedValue({ id: 'pc1', clusterCode: 'RW01', assignedPmId: 'pm1' });
      await service.createFromBaOpen('ba1', 'admin1');
      expect(prisma.permitCluster.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ currentPhase: 'SITE_VISIT' }) }));
    });

    it('links to correct baOpenId and visitRequestId', async () => { // NEW: relation fields
      prisma.baOpen.findUnique.mockResolvedValue({ id: 'ba1', visitRequestId: 'vr1', rwCode: 'RW01', ispCustomer: 'Fiber', visitRequest: { assignedPmId: 'pm1', requestedBy: 'sv1', fiberType: 'FTTH', cleanList: { rwCode: 'RW01' } } });
      prisma.permitCluster.findUnique.mockResolvedValue(null);
      prisma.permitCluster.create.mockResolvedValue({ id: 'pc1', clusterCode: 'RW01', assignedPmId: 'pm1' });
      await service.createFromBaOpen('ba1', 'admin1');
      expect(prisma.permitCluster.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ baOpenId: 'ba1', visitRequestId: 'vr1' }) }));
    });

    it('emits permitCluster:created to assigned PM', async () => { // NEW: PM socket notification
      prisma.baOpen.findUnique.mockResolvedValue({ id: 'ba1', visitRequestId: 'vr1', rwCode: 'RW01', ispCustomer: 'Fiber', visitRequest: { assignedPmId: 'pm1', requestedBy: 'sv1', fiberType: 'FTTH', cleanList: { rwCode: 'RW01' } } });
      prisma.permitCluster.findUnique.mockResolvedValue(null);
      prisma.permitCluster.create.mockResolvedValue({ id: 'pc1', clusterCode: 'RW01', assignedPmId: 'pm1' });
      await service.createFromBaOpen('ba1', 'admin1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('user:pm1', 'permitCluster:created', expect.any(Object));
    });
  });

  describe('advancePhase', () => { // NEW: phase advance behavior
    it('updates currentPhase correctly', async () => { // NEW: phase update
      prisma.permitCluster.findUnique.mockResolvedValue({ id: 'pc1', currentPhase: 'APD_DRAFTING' });
      prisma.permitCluster.update.mockResolvedValue({ id: 'pc1', clusterCode: 'RW01', assignedPmId: 'pm1', currentPhase: 'DRM_REVIEW' });
      const result = await service.advancePhase('pc1', 'DRM_REVIEW' as any, 'admin1', 'ADMIN' as any);
      expect(result.currentPhase).toBe('DRM_REVIEW');
    });

    it('emits permitCluster:phaseAdvanced with fromPhase and toPhase', async () => { // NEW: payload fields
      prisma.permitCluster.findUnique.mockResolvedValue({ id: 'pc1', currentPhase: 'APD_DRAFTING' });
      prisma.permitCluster.update.mockResolvedValue({ id: 'pc1', clusterCode: 'RW01', assignedPmId: 'pm1', currentPhase: 'DRM_REVIEW' });
      await service.advancePhase('pc1', 'DRM_REVIEW' as any, 'admin1', 'ADMIN' as any);
      expect(gateway.emitToRoom).toHaveBeenCalledWith('user:pm1', 'permitCluster:phaseAdvanced', expect.objectContaining({ fromPhase: 'APD_DRAFTING', toPhase: 'DRM_REVIEW' }));
    });

    it('emits to PM + PM_SENIOR + ADMIN rooms', async () => { // NEW: room fanout
      prisma.permitCluster.findUnique.mockResolvedValue({ id: 'pc1', currentPhase: 'APD_DRAFTING' });
      prisma.permitCluster.update.mockResolvedValue({ id: 'pc1', clusterCode: 'RW01', assignedPmId: 'pm1', currentPhase: 'DRM_REVIEW' });
      await service.advancePhase('pc1', 'DRM_REVIEW' as any, 'admin1', 'ADMIN' as any);
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:PM_SENIOR', 'permitCluster:phaseAdvanced', expect.any(Object));
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:ADMIN', 'permitCluster:phaseAdvanced', expect.any(Object));
    });
  });

  describe('markConstructionReady', () => { // delegates to advancePhaseInternal(…, CLAIM_SUBMISSION)
    it('updates currentPhase to CLAIM_SUBMISSION', async () => { // NEW: permit-flow matrix — construction-ready gate maps here
      prisma.permitCluster.findUnique.mockResolvedValue({
        id: 'pc1',
        currentPhase: 'SIP_REQUEST',
        assignedPmId: 'pm1',
        clusterCode: 'RW01',
      });
      prisma.permitCluster.update.mockResolvedValue({
        id: 'pc1',
        clusterCode: 'RW01',
        assignedPmId: 'pm1',
        currentPhase: 'CLAIM_SUBMISSION',
      });
      const result = await service.markConstructionReady('pc1', 'admin1');
      expect(prisma.permitCluster.update).toHaveBeenCalledWith({
        where: { id: 'pc1' },
        data: { currentPhase: 'CLAIM_SUBMISSION' },
      });
      expect(result.currentPhase).toBe('CLAIM_SUBMISSION');
    });

    it('broadcasts cluster:phaseAdvanced via gateway.server', async () => { // NEW: advancePhaseInternal fanout
      prisma.permitCluster.findUnique.mockResolvedValue({
        id: 'pc1',
        currentPhase: 'SIP_REQUEST',
        assignedPmId: 'pm1',
        clusterCode: 'RW01',
      });
      prisma.permitCluster.update.mockResolvedValue({
        id: 'pc1',
        clusterCode: 'RW01',
        assignedPmId: 'pm1',
        currentPhase: 'CLAIM_SUBMISSION',
      });
      await service.markConstructionReady('pc1', 'admin1');
      expect(gateway.server.emit).toHaveBeenCalledWith(
        'cluster:phaseAdvanced',
        expect.objectContaining({ clusterId: 'pc1', newPhase: 'CLAIM_SUBMISSION', previousPhase: 'SIP_REQUEST' }),
      );
    });

    it('emits permitCluster:phaseAdvanced to PM, PM_SENIOR, and ADMIN rooms', async () => { // NEW: same as manual advance
      prisma.permitCluster.findUnique.mockResolvedValue({
        id: 'pc1',
        currentPhase: 'SIP_REQUEST',
        assignedPmId: 'pm1',
        clusterCode: 'RW01',
      });
      prisma.permitCluster.update.mockResolvedValue({
        id: 'pc1',
        clusterCode: 'RW01',
        assignedPmId: 'pm1',
        currentPhase: 'CLAIM_SUBMISSION',
      });
      await service.markConstructionReady('pc1', 'admin1');
      expect(gateway.emitToRoom).toHaveBeenCalledWith('user:pm1', 'permitCluster:phaseAdvanced', expect.any(Object));
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:PM_SENIOR', 'permitCluster:phaseAdvanced', expect.any(Object));
      expect(gateway.emitToRoom).toHaveBeenCalledWith('role:ADMIN', 'permitCluster:phaseAdvanced', expect.any(Object));
      expect(gateway.emitToRooms).toHaveBeenCalledWith(
        ['user:pm1', 'role:PM_SENIOR', 'role:ADMIN'],
        'cluster:phaseAdvanced',
        expect.objectContaining({ fromPhase: 'SIP_REQUEST', toPhase: 'CLAIM_SUBMISSION' }),
      );
    });
  });
});
