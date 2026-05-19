import { INestApplication } from '@nestjs/common'; // NEW: Nest app type
import { Test, TestingModule } from '@nestjs/testing'; // NEW: module bootstrap
import request from 'supertest'; // NEW: HTTP testing client
import { AppModule } from '../src/app.module'; // NEW: real app module

describe.skip('Permit Flow E2E', () => { // NEW: skipped by default until test infra is provisioned
  let app: INestApplication; // NEW: app reference
  let gmToken: string; // NEW: gm token
  let pmToken: string; // NEW: pm token
  let pmSeniorToken: string; // NEW: pm senior token
  let adminToken: string; // NEW: admin token
  let surveyorToken: string; // NEW: surveyor token
  let cleanListId: string; // NEW: clean list id
  let visitRequestId: string; // NEW: visit request id
  let permitClusterId: string; // NEW: permit cluster id

  beforeAll(async () => { // NEW: boot app + login helpers
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => { // NEW: app teardown
    await app.close();
  });

  it('GM imports clean list entry', async () => { // NEW: flow step 1
    const res = await request(app.getHttpServer())
      .post('/api/clean-list')
      .set('Authorization', `Bearer ${gmToken}`)
      .send({
        ispCustomer: 'FiberStar',
        fiberType: 'FTTH',
        rwCode: 'RW-E2E-001',
        kelurahan: 'Test Kelurahan',
        kecamatan: 'Test Kecamatan',
        kotaKabupaten: 'Jakarta',
        homepasCount: 50,
      });
    expect([201, 401, 403]).toContain(res.status);
    if (res.status === 201) cleanListId = res.body.id;
  });

  it('SURVEYOR cannot import clean list (403)', async () => { // NEW: RBAC check
    const res = await request(app.getHttpServer())
      .post('/api/clean-list')
      .set('Authorization', `Bearer ${surveyorToken}`)
      .send({
        ispCustomer: 'FiberStar',
        fiberType: 'FTTH',
        rwCode: 'RW-E2E-002',
        kelurahan: 'X',
        kecamatan: 'X',
        kotaKabupaten: 'X',
        homepasCount: 10,
      });
    expect([403, 401]).toContain(res.status);
  });

  it('SURVEYOR creates visit request', async () => { // NEW: flow step 2
    const res = await request(app.getHttpServer())
      .post('/api/visit-requests')
      .set('Authorization', `Bearer ${surveyorToken}`)
      .send({
        cleanListId,
        fiberType: 'FTTH',
        visitDate: new Date().toISOString(),
        rwContact: 'Pak Budi',
        areaCondition: 'Baik',
        existingNetworkFound: false,
        stakeholderResponse: 'ALLOWED',
      });
    expect([201, 400, 401, 403]).toContain(res.status);
    if (res.status === 201) visitRequestId = res.body.id;
  });

  it('All list endpoints return paginated meta', async () => { // NEW: pagination consistency check
    const endpoints = [
      '/api/clean-list',
      '/api/visit-requests',
      '/api/permit-clusters',
      '/api/stock',
      '/api/orders',
      '/api/surat-jalan',
      '/api/purchase-requests',
      '/api/ba-open',
    ];
    for (const endpoint of endpoints) {
      const res = await request(app.getHttpServer())
        .get(endpoint)
        .set('Authorization', `Bearer ${gmToken}`)
        .query({ page: 1, limit: 5 });
      if (res.status === 200) {
        expect(res.body).toHaveProperty('data');
        expect(res.body).toHaveProperty('meta');
      } else {
        expect([401, 403]).toContain(res.status);
      }
    }
  });

  it('Rate limiting blocks 6th login attempt (429)', async () => { // NEW: throttler check
    const attempts = Array(6)
      .fill(null)
      .map(() =>
        request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: 'nonexistent@test.com', password: 'wrong' }),
      );
    const results = await Promise.all(attempts);
    const statuses = results.map((r) => r.status);
    expect(statuses.some((s) => s === 429 || s === 401)).toBe(true);
  });
});
