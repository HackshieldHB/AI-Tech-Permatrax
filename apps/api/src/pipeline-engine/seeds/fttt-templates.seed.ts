import { PrismaClient, FiberType, Role } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Seeding FTTT Templates...');

  // 1. Upsert IspCustomers (Confirmation 1)
  const customers = [
    { name: 'PST', code: 'PST' },
    { name: 'iFORTE', code: 'IFORTE' },
    { name: 'Telkom Infra', code: 'TELKOM_INFRA' },
  ];

  const customerMap: Record<string, string> = {};

  for (const c of customers) {
    const res = await prisma.ispCustomer.upsert({
      where: { code: c.code },
      update: { name: c.name },
      create: { 
        name: c.name, 
        code: c.code,
        createdBy: 'seed-system' // Assuming this is handled or use a valid user ID if needed
      },
    });
    customerMap[c.name] = res.id;
    console.log(`✅ Customer upserted: ${c.name}`);
  }

  // 2. TEMPLATE 1: FTTT × PST
  await seedPstTemplate(customerMap['PST']);

  // 3. TEMPLATE 2: FTTT × iFORTE
  await seedIforteTemplate(customerMap['iFORTE']);

  // 4. TEMPLATE 3: FTTT × Telkom Infra
  await seedTelkomInfraTemplate(customerMap['Telkom Infra']);

  console.log('✨ All FTTT Templates seeded successfully!');
}

async function seedPstTemplate(customerId: string) {
  const name = 'FTTT - PST Node B';
  const existing = await prisma.pipelineTemplate.findFirst({
    where: { name, fiberType: FiberType.FTTT, ispCustomerId: customerId }
  });
  if (existing) return;

  await prisma.pipelineTemplate.create({
    data: {
      name,
      fiberType: FiberType.FTTT,
      ispCustomerId: customerId,
      stages: {
        create: [
          {
            sequence: 1,
            name: 'Perizinan',
            shortLabel: 'IZIN',
            color: '#3B82F6',
            notifyRoles: [Role.PM_FTTT, Role.SURVEYOR_FTTT],
            allowedActorRoles: [Role.PM_FTTT, Role.ADMIN],
            requiredDocuments: {
              create: [{ name: 'Surat Perizinan Teknis', formats: ['PDF'], isRequired: true }]
            }
          },
          {
            sequence: 2,
            name: 'DRM & BOQ',
            shortLabel: 'DRM',
            color: '#8B5CF6',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.PM_FTTT, Role.SURVEYOR_FTTT],
            allowedActorRoles: [Role.PM_FTTT, Role.SURVEYOR_FTTT],
            requiredDocuments: {
              create: [
                { name: 'BOQ Excel', formats: ['XLSX', 'XLS'], isRequired: true },
                { name: 'DRM Excel', formats: ['XLSX', 'XLS'], isRequired: true }
              ]
            }
          },
          {
            sequence: 3,
            name: 'Procurement',
            shortLabel: 'PROC',
            color: '#F59E0B',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.PURCHASING, Role.PM_FTTT],
            allowedActorRoles: [Role.PURCHASING, Role.ADMIN],
            requiredDocuments: {
              create: [{ name: 'Purchase Order PDF', formats: ['PDF'], isRequired: true }]
            }
          },
          {
            sequence: 4,
            name: 'Implementasi',
            shortLabel: 'IMP',
            color: '#10B981',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.PM_FTTT],
            allowedActorRoles: [Role.PM_FTTT, Role.OPERATIONAL_MANAGER]
          },
          {
            sequence: 5,
            name: 'Dokumentasi Pre-ATP',
            shortLabel: 'PRE-ATP',
            color: '#EC4899',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.PM_FTTT],
            allowedActorRoles: [Role.PM_FTTT],
            requiredDocuments: {
              create: [
                { name: 'Pre-Doc ATP', formats: ['PDF'], isRequired: true },
                { name: 'Pre-Doc BAUT', formats: ['PDF'], isRequired: true }
              ]
            }
          },
          {
            sequence: 6,
            name: 'ATP & BAUT',
            shortLabel: 'ATP',
            color: '#06B6D4',
            triggerConditions: { previousStageStatus: 'DONE', smileProgressMin: 90 },
            notifyRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER],
            allowedActorRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER],
            requiredDocuments: {
              create: [
                { name: 'ATP Foto', formats: ['PDF'], isRequired: true },
                { name: 'BAUT', formats: ['PDF'], isRequired: true }
              ]
            }
          },
          {
            sequence: 7,
            name: 'Rekonsiliasi DRM',
            shortLabel: 'RECON',
            color: '#6366F1',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.PM_FTTT, Role.FINANCE],
            allowedActorRoles: [Role.PM_FTTT, Role.FINANCE],
            requiredDocuments: {
              create: [{ name: 'DRM & Actual Comparison', formats: ['PDF'], isRequired: true }]
            }
          },
          {
            sequence: 8,
            name: 'BAST 1',
            shortLabel: 'BAST1',
            color: '#14B8A6',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.PM_FTTT, Role.FINANCE, Role.GENERAL_MANAGER],
            allowedActorRoles: [Role.FINANCE, Role.GENERAL_MANAGER],
            requiredDocuments: {
              create: [
                { name: 'Jaminan Pemeliharaan', formats: ['PDF'], isRequired: true },
                { name: 'Jaminan Pelaksanaan', formats: ['PDF'], isRequired: true }
              ]
            }
          },
          {
            sequence: 9,
            name: 'Good Receipt',
            shortLabel: 'GR',
            color: '#F97316',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.FINANCE, Role.PM_FTTT],
            allowedActorRoles: [Role.FINANCE, Role.ADMIN],
            requiredDocuments: {
              create: [
                { name: 'Completion Cert GRN', formats: ['PDF'], isRequired: true },
                { name: 'Lampiran SMILE App', formats: ['PDF'], isRequired: true }
              ]
            }
          },
          {
            sequence: 10,
            name: 'Invoice',
            shortLabel: 'INV',
            color: '#22C55E',
            triggerConditions: { previousStageStatus: 'DONE' },
            notifyRoles: [Role.FINANCE],
            allowedActorRoles: [Role.FINANCE]
          },
          {
            sequence: 11,
            name: 'BAST II',
            shortLabel: 'BAST2',
            color: '#22C55E',
            triggerConditions: { previousStageStatus: 'DONE', daysSinceStage: { stageSequence: 8, minDays: 365 } },
            notifyRoles: [Role.PM_FTTT, Role.FINANCE, Role.GENERAL_MANAGER],
            allowedActorRoles: [Role.FINANCE, Role.GENERAL_MANAGER],
            requiredDocuments: {
              create: [{ name: 'BAST II', formats: ['PDF'], isRequired: true }]
            }
          }
        ]
      }
    }
  });
  console.log(`✅ Template seeded: ${name}`);
}

async function seedIforteTemplate(customerId: string) {
  const name = 'FTTT - iFORTE Fiberisasi';
  const existing = await prisma.pipelineTemplate.findFirst({
    where: { name, fiberType: FiberType.FTTT, ispCustomerId: customerId }
  });
  if (existing) return;

  await prisma.pipelineTemplate.create({
    data: {
      name,
      fiberType: FiberType.FTTT,
      ispCustomerId: customerId,
      stages: {
        create: [
          { sequence: 1, name: 'SPK', shortLabel: 'SPK', color: '#3B82F6', allowedActorRoles: [Role.PM_FTTT, Role.ADMIN] },
          { 
            sequence: 2, name: 'Survey & Izin PU', shortLabel: 'SURV', color: '#8B5CF6', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.SURVEYOR_FTTT],
            requiredDocuments: { create: [{ name: 'PO', formats: ['PDF'], isRequired: true }] }
          },
          { 
            sequence: 3, name: 'Procurement Paralel', shortLabel: 'PROC', color: '#F59E0B', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PURCHASING, Role.ADMIN],
            requiredDocuments: { create: [{ name: 'Purchase Order', formats: ['PDF'], isRequired: true }] }
          },
          { 
            sequence: 4, name: 'Implementasi', shortLabel: 'IMP', color: '#10B981', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.OPERATIONAL_MANAGER]
          },
          { 
            sequence: 5, name: 'RFS', shortLabel: 'RFS', color: '#06B6D4', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT]
          },
          { 
            sequence: 6, name: 'Dokumentasi', shortLabel: 'DOC', color: '#EC4899', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.SURVEYOR_FTTT],
            requiredDocuments: { create: [{ name: 'Foto dan Evidence', formats: ['PDF'], isRequired: true }] }
          },
          { 
            sequence: 7, name: 'ATP', shortLabel: 'ATP', color: '#6366F1', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER]
          },
          { 
            sequence: 8, name: 'PunchList', shortLabel: 'PUNCH', color: '#F97316', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.OPERATIONAL_MANAGER]
          },
          { 
            sequence: 9, name: 'Endorsement', shortLabel: 'ENDORS', color: '#14B8A6', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER],
            requiredDocuments: { create: [{ name: 'BOQ Hasil Sistem', formats: ['PDF', 'XLSX'], isRequired: true }] }
          },
          { 
            sequence: 10, name: 'Sanggah', shortLabel: 'SANGGAH', color: '#EF4444', 
            triggerConditions: { previousStageStatus: 'DONE', manualUnlock: true },
            allowedActorRoles: [Role.ADMIN, Role.GENERAL_MANAGER]
          },
          { 
            sequence: 11, name: 'PO Final', shortLabel: 'PO-F', color: '#22C55E', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PURCHASING, Role.ADMIN],
            requiredDocuments: { create: [{ name: 'PO Final', formats: ['PDF'], isRequired: true }] }
          },
          { 
            sequence: 12, name: 'Upload PSS', shortLabel: 'PSS', color: '#3B82F6', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.ADMIN],
            requiredDocuments: { create: [{ name: 'Dokumen PSS', formats: ['ANY'], isRequired: true }] }
          },
          { 
            sequence: 13, name: 'MCV', shortLabel: 'MCV', color: '#8B5CF6', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE]
          },
          { 
            sequence: 14, name: 'Invoice', shortLabel: 'INV', color: '#22C55E', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE]
          }
        ]
      }
    }
  });
  console.log(`✅ Template seeded: ${name}`);
}

async function seedTelkomInfraTemplate(customerId: string) {
  const name = 'FTTT - Telkom Infra';
  const existing = await prisma.pipelineTemplate.findFirst({
    where: { name, fiberType: FiberType.FTTT, ispCustomerId: customerId }
  });
  if (existing) return;

  await prisma.pipelineTemplate.create({
    data: {
      name,
      fiberType: FiberType.FTTT,
      ispCustomerId: customerId,
      stages: {
        create: [
          { 
            sequence: 1, name: 'Kontrak', shortLabel: 'KONTRAK', color: '#3B82F6', 
            allowedActorRoles: [Role.PM_FTTT, Role.ADMIN],
            requiredDocuments: { 
              create: [
                { name: 'SPK/PO', formats: ['PDF'], isRequired: false },
                { name: 'Kontrak', formats: ['PDF'], isRequired: false }
              ] 
            }
          },
          { 
            sequence: 2, name: 'Down Payment', shortLabel: 'DP', color: '#8B5CF6', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE, Role.ADMIN],
            requiredDocuments: { 
              create: [
                { name: 'Jaminan Uang Muka', formats: ['PDF'], isRequired: false },
                { name: 'Jaminan Pelaksanaan', formats: ['PDF'], isRequired: false }
              ] 
            }
          },
          { 
            sequence: 3, name: 'Penyelesaian BAUT', shortLabel: 'BAUT', color: '#F59E0B', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER],
            requiredDocuments: { 
              create: [
                { name: 'Kontrak', formats: ['PDF'], isRequired: true },
                { name: 'Amandemen', formats: ['PDF'], isRequired: false },
                { name: 'BA Rekonsiliasi', formats: ['PDF', 'XLSX'], isRequired: true }
              ] 
            }
          },
          { 
            sequence: 4, name: 'BAPP', shortLabel: 'BAPP', color: '#10B981', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER],
            requiredDocuments: { 
              create: [
                { name: 'Amandemen II', formats: ['PDF'], isRequired: false },
                { name: 'Surat Waspang No Dinas', formats: ['PDF'], isRequired: true },
                { name: 'Risalah Rapat/MOM', formats: ['PDF'], isRequired: true }
              ] 
            }
          },
          { 
            sequence: 5, name: 'BAST & BAPWPP', shortLabel: 'BAST', color: '#06B6D4', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE, Role.GENERAL_MANAGER],
            requiredDocuments: { 
              create: [
                { name: 'Amandemen I & II', formats: ['PDF'], isRequired: false },
                { name: 'PO', formats: ['PDF'], isRequired: true },
                { name: 'BOQ & Nilai Perhitungan', formats: ['XLSX'], isRequired: true }
              ] 
            }
          },
          { 
            sequence: 6, name: 'BA Penutupan', shortLabel: 'CLOSE', color: '#EC4899', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.PM_FTTT, Role.GENERAL_MANAGER]
          },
          { 
            sequence: 7, name: 'Good Receipt', shortLabel: 'GR', color: '#6366F1', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE, Role.ADMIN],
            requiredDocuments: { 
              create: [
                { name: 'Completion Cert GRN', formats: ['PDF'], isRequired: true },
                { name: 'Lampiran SMILE', formats: ['PDF'], isRequired: true }
              ] 
            }
          },
          { 
            sequence: 8, name: 'Jaminan Pemeliharaan', shortLabel: 'JAM-P', color: '#F97316', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE]
          },
          { 
            sequence: 9, name: 'Invoice Final', shortLabel: 'INV', color: '#22C55E', 
            triggerConditions: { previousStageStatus: 'DONE' },
            allowedActorRoles: [Role.FINANCE]
          },
          { 
            sequence: 10, name: 'BAST II', shortLabel: 'BAST2', color: '#22C55E', 
            triggerConditions: { previousStageStatus: 'DONE', daysSinceStage: { stageSequence: 5, minDays: 365 } },
            allowedActorRoles: [Role.FINANCE, Role.GENERAL_MANAGER],
            requiredDocuments: { 
              create: [{ name: 'BAST II', formats: ['PDF'], isRequired: true }] 
            }
          }
        ]
      }
    }
  });
  console.log(`✅ Template seeded: ${name}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
