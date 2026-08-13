import { AiKnowledgeService } from './ai-knowledge.service';
import { AiOllamaService } from './ai-ollama.service';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools.service';
import { PERMATRAX_KNOWLEDGE_SEED } from './ai-knowledge.seed';
import {
  isFinanceBudgetQuery,
  resolveFollowUp,
  detectFinanceMode,
  detectFinanceMetrics,
  detectTopNLimit,
  classifyPaIntent,
  extractProjectNeedle,
  resolveNavigation,
  isCapabilityInquiry,
  isAmbiguousQuery,
  isUserCorrection,
  isProjectCountQuery,
  needsScopeClarification,
  refineRecoveryQuery,
  resolveSessionContext,
} from './ai-nlu';
import type { AuthUser } from '../auth/types/auth-user.types';
import { Role } from '@prisma/client';

describe('PermaTrax AI chatbot (logic)', () => {
  const user: AuthUser = {
    userId: 'user-1',
    role: Role.GENERAL_MANAGER,
    fiberType: null,
  };

  function buildChunkRows() {
    const rows: Array<{
      id: string;
      keywords: string;
      content: string;
      article: {
        id: string;
        title: string;
        module: string;
        category: string;
        sourceUri: string | null;
        rolesAllowed: string[];
      };
    }> = [];
    for (const article of PERMATRAX_KNOWLEDGE_SEED) {
      article.chunks.forEach((c, i) => {
        rows.push({
          id: `${article.slug}-${i}`,
          keywords: c.keywords,
          content: c.content,
          article: {
            id: article.slug,
            title: article.title,
            module: article.module,
            category: article.category,
            sourceUri: article.sourceUri,
            rolesAllowed: article.rolesAllowed,
          },
        });
      });
    }
    return rows;
  }

  function makePrisma() {
    const chunks = buildChunkRows();
    const conversations = new Map<string, { id: string; userId: string }>();
    const messages: Array<{
      id: string;
      conversationId: string;
      role: string;
      content: string;
      toolTraces?: unknown;
    }> = [];

    const demoProject = {
      code: 'SEG-2026-042',
      name: 'Segment Test Jua TI',
      totalBudget: 850000000,
      materialBudget: 500000000,
      jasaBudget: 350000000,
      materialSpent: 120000000,
      jasaSpent: 80000000,
      status: 'ACTIVE',
      hierarchyLevel: 'SEGMENT',
      isOverbudget: false,
      updatedAt: new Date(),
    };

    return {
      aiKnowledgeArticle: {
        count: jest.fn().mockResolvedValue(chunks.length),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      aiKnowledgeChunk: {
        findMany: jest.fn().mockResolvedValue(chunks),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      aiConversation: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.id ? conversations.get(where.id) ?? null : null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `conv-${conversations.size + 1}`,
            userId: data.userId,
            sessionState: null as any,
          };
          conversations.set(row.id, row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = conversations.get(where.id);
          if (row && data?.sessionState) {
            (row as any).sessionState = data.sessionState;
          }
          return row ?? {};
        }),
      },
      cleanList: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      permitCluster: {
        count: jest.fn().mockResolvedValue(7),
        findMany: jest.fn().mockResolvedValue([]),
      },
      aiMessage: {
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `msg-${messages.length + 1}`,
            conversationId: data.conversationId,
            role: data.role,
            content: data.content,
            toolTraces: data.toolTraces ?? null,
          };
          messages.push(row);
          return row;
        }),
        findMany: jest.fn(async ({ where }: any) => {
          return messages
            .filter((m) => m.conversationId === where?.conversationId)
            .slice()
            .reverse();
        }),
        findFirst: jest.fn(),
      },
      aiPromptLog: {
        create: jest.fn().mockResolvedValue({}),
      },
      aiFeedback: {
        upsert: jest.fn(),
      },
      cashOperationRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      visitRequest: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      purchaseRequest: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      stockItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      ftttProject: {
        count: jest.fn().mockResolvedValue(2),
      },
      ftttTransaction: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      supplier: {
        count: jest.fn().mockResolvedValue(12),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      financeProject: {
        count: jest.fn().mockResolvedValue(18),
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            totalBudget: 12540000000,
            materialBudget: 8000000000,
            jasaBudget: 4540000000,
            materialSpent: 3000000000,
            jasaSpent: 1820000000,
          },
          _count: 18,
        }),
        findFirst: jest.fn(async ({ orderBy }: any) => {
          if (orderBy?.totalBudget === 'desc') {
            return {
              code: 'SEG-1',
              name: 'Biggest',
              totalBudget: 5000000000,
            };
          }
          return {
            code: 'SITE-1',
            name: 'Smallest',
            totalBudget: 1000000,
          };
        }),
        findMany: jest.fn(async ({ where }: any) => {
          const and = where?.AND as
            | Array<{ OR?: Array<{ name?: { contains: string } }> }>
            | undefined;
          if (and?.length) {
            const tokens = and
              .map((clause) => clause.OR?.[0]?.name?.contains?.toLowerCase())
              .filter(Boolean) as string[];
            const hay = demoProject.name.toLowerCase();
            if (tokens.every((t) => hay.includes(t))) {
              return [demoProject];
            }
            return [];
          }
          const or = where?.OR as
            | Array<{ name?: { contains: string }; code?: { contains: string } }>
            | undefined;
          if (or?.length) {
            const needle = (
              or[0]?.name?.contains ||
              or[0]?.code?.contains ||
              ''
            ).toLowerCase();
            if (
              demoProject.name.toLowerCase().includes(needle) ||
              demoProject.code.toLowerCase().includes(needle)
            ) {
              return [demoProject];
            }
            return [];
          }
          return [];
        }),
      },
      __messages: messages,
      __conversations: conversations,
    };
  }

  function makeServices(prisma: ReturnType<typeof makePrisma>) {
    const knowledge = new AiKnowledgeService(prisma as any);
    const ollama = {
      isAvailable: jest.fn().mockResolvedValue(false),
      chat: jest.fn().mockResolvedValue({ text: '', used: false }),
      getModelName: () => 'llama3.2',
    } as unknown as AiOllamaService;
    const tools = new AiToolsService(prisma as any);
    const ai = new AiService(prisma as any, knowledge, ollama, tools);
    return { ai, knowledge, tools, ollama };
  }

  it('NLU: slang variants map to finance budget query', () => {
    expect(isFinanceBudgetQuery('Duit project aktif sekarang berapa?')).toBe(
      true,
    );
    expect(isFinanceBudgetQuery('Total anggaran aktif hari ini?')).toBe(true);
    expect(
      isFinanceBudgetQuery(
        'Finance Project total budget keseluruhan project berapa per hari ini?',
      ),
    ).toBe(true);
    expect(detectFinanceMode('Top 10 budget terbesar')).toBe('top_budget');
  });

  it('NLU: named project → search mode, not global summary', () => {
    const q = 'Total budget project Segment Test Jua TI berapa?';
    expect(extractProjectNeedle(q)).toMatch(/Test Jua TI/i);
    expect(detectFinanceMode(q)).toBe('search');
    expect(classifyPaIntent(q)).toBe('data');
  });

  it('NLU: howto / navigation intents', () => {
    expect(classifyPaIntent('Gimana cara add stock?')).toBe('howto');
    expect(classifyPaIntent('Ajuin budget perizinan implementasi?')).toBe(
      'howto',
    );
    expect(classifyPaIntent('Daftar dokumen dimana?')).toBe('navigation');
    expect(resolveNavigation('Daftar dokumen dimana?')?.answer).toMatch(
      /Sidebar.*Dokumen/i,
    );
  });

  it('NLU: follow-up hitung dong expands prior question', () => {
    const q = resolveFollowUp('Yaudah hitung dong.', [
      'Berapa nominal total budget project aktif saat ini?',
    ]);
    expect(q).toContain('budget project aktif');
    expect(q).toContain('hitung');
  });

  it('answers active finance budget aggregate with structured format', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(
      user,
      'Finance Project total budget keseluruhan project berapa per hari ini?',
    );
    expect(res.toolTraces.some((t) => t.name === 'finance_analytics' && t.ok)).toBe(
      true,
    );
    expect(res.answer).toMatch(/Total Project/);
    expect(res.answer).toMatch(/Total Budget/);
    expect(res.answer).toMatch(/12\.540\.000\.000|12540000000|Rp/);
    expect(res.answer).not.toMatch(/tidak ada Finance Project/i);
    expect(res.answer).not.toMatch(/Ollama/);
  });

  it('answers named project budget without aggregating all ACTIVE', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(
      user,
      'Total budget project Segment Test Jua TI berapa?',
    );
    expect(res.intent).toBe('data');
    expect(res.toolTraces.some((t) => t.name === 'finance_analytics' && t.ok)).toBe(
      true,
    );
    expect(res.answer).toMatch(/Test Jua TI/i);
    expect(res.answer).toMatch(/850\.000\.000|850000000|Rp/);
    expect(res.answer).not.toMatch(/Total Project\s*:/i);
    expect(res.answer).not.toMatch(/12\.540/);
  });

  it('howto add stock returns inventory steps, not Purchase Request FAQ', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Gimana cara add stock?');
    expect(res.intent).toBe('howto');
    expect(res.answer).toMatch(/Stok Barang|Tambah Barang|\/stock/i);
    expect(res.answer).not.toMatch(/^Purchase Request \(PR\) dibuat/i);
  });

  it('howto ajuin budget perizinan returns SOP workflow', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Ajuin budget perizinan implementasi?');
    expect(res.intent).toBe('howto');
    expect(res.answer).toMatch(/ajukan|SKOM|approval|perizinan/i);
    expect(res.answer).not.toMatch(/menyimpan anggaran proyek \(totalBudget/i);
  });

  it('navigation daftar dokumen points to sidebar path', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Daftar dokumen dimana?');
    expect(res.intent).toBe('navigation');
    expect(res.answer).toMatch(/Sidebar/i);
    expect(res.answer).toMatch(/Dokumen/i);
    expect(res.answer).toMatch(/document-list/i);
    expect(res.answer).not.toMatch(/Apa itu PermaTrax|platform manajemen perizinan/i);
  });

  it('answers slang budget query without requiring "finance project" phrase', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Berapa nominal total budget project aktif saat ini?');
    expect(res.toolTraces.some((t) => t.name === 'finance_analytics')).toBe(true);
    expect(res.answer).toMatch(/Total Budget/i);
  });

  it('follow-up "hitung dong" uses prior finance context', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const first = await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
    );
    const second = await ai.chat(user, 'Yaudah hitung dong.', first.conversationId);
    expect(second.toolTraces.some((t) => t.name === 'finance_analytics')).toBe(
      true,
    );
    expect(second.answer).toMatch(/Total Budget/i);
  });

  it('seed knowledge includes Visit Request and howto articles', () => {
    expect(PERMATRAX_KNOWLEDGE_SEED.map((a) => a.slug)).toEqual(
      expect.arrayContaining([
        'visit-request-guide',
        'overview-permatrax',
        'howto-add-stock',
        'nav-document-list',
        'howto-budget-perizinan',
      ]),
    );
  });

  it('refuses off-topic questions', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Siapa presiden Indonesia sekarang?');
    expect(res.refusal).toBe(true);
  });

  it('answers last fund disbursement from live cash op data', async () => {
    const prisma = makePrisma();
    (prisma as any).cashOperationRequest.findFirst = jest.fn().mockResolvedValue({
      requestNumber: 'CA-2026-001',
      type: 'CASH_ADVANCE',
      description: 'Operasional survey RW 05',
      amount: 2500000,
      disbursedAmount: 2500000,
      finalApprovedAmount: 2500000,
      status: 'DISBURSED',
      disbursedAt: new Date('2026-07-28T10:00:00+07:00'),
      category: 'Survey',
      projectRef: null,
      requester: { name: 'Budi', email: 'budi@x.com', role: 'PM_FTTH' },
      financeProject: { code: 'SEG-1', name: 'Demo' },
    });
    const { ai } = makeServices(prisma as any);
    const res = await ai.chat(user, 'Kapan dana terakhir keluar?');
    expect(res.answer).toMatch(/CA-2026-001/);
    expect(res.answer).toMatch(/Budi/);
  });

  // --- Permarax AI 3 (PAI-BHV-001 … 007) ---

  it('BHV-001/003: project count uses project_count, not empty search', () => {
    const q =
      'Berdasarkan Finance Project saat ini, sudah ada berapa project yang tersedia saat ini?';
    expect(isProjectCountQuery(q)).toBe(true);
    expect(extractProjectNeedle(q)).toBeNull();
    expect(detectFinanceMode(q)).toBe('project_count');
    expect(classifyPaIntent(q)).toBe('data');
  });

  it('BHV-001: answers project count with aggregate, not "tidak ditemukan"', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(
      user,
      'Berdasarkan Finance Project saat ini, sudah ada berapa project yang tersedia saat ini?',
    );
    expect(res.answer).toMatch(/Total Project/i);
    expect(res.answer).not.toMatch(/tidak ditemukan/i);
  });

  it('BHV-001: correction retries with broader strategy, not identical search', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn(async ({ where }: any) => {
      if (where?.AND || where?.OR) return [];
      return [
        {
          code: 'SEG-1',
          name: 'Demo A',
          status: 'ACTIVE',
          totalBudget: 1000000,
        },
      ];
    });
    (prisma as any).financeProject.count = jest.fn(async ({ where }: any) => {
      if (where?.status === 'ACTIVE') return 18;
      if (where?.status === 'CLOSED') return 3;
      if (where?.status === 'ARCHIVED') return 2;
      return 21;
    });
    const { ai } = makeServices(prisma);
    const first = await ai.chat(user, 'Cari project XYZ-NOTEXIST budgetnya berapa?');
    const second = await ai.chat(
      user,
      'Tapi aku lihat di dalam Finance Projects ada banyak project loh.',
      first.conversationId,
    );
    expect(isUserCorrection('Tapi aku lihat di dalam Finance Projects ada banyak project loh.')).toBe(
      true,
    );
    expect(second.intent).toBe('correction');
    expect(second.answer).not.toBe(first.answer);
    expect(second.answer).toMatch(/Terima kasih|lebih luas|pencarian ulang/i);
    expect(second.answer).toMatch(/ACTIVE|CLOSED|Non-ARCHIVED|strategi lebih luas/i);
    expect(second.answer).not.toMatch(/^Project tidak ditemukan/i);
  });

  it('BHV-002/006: capability inquiry does not execute retrieval', async () => {
    expect(
      isCapabilityInquiry(
        'Halo PAI, aku ingin bertanya seputar Finance, apakah bisa?',
      ),
    ).toBe(true);
    expect(
      isCapabilityInquiry('Apakah kamu bisa menghitung total budget project?'),
    ).toBe(true);
    expect(classifyPaIntent('Apa saja yang bisa kamu lakukan?')).toBe(
      'capability',
    );
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const res = await ai.chat(
      user,
      'Apakah kamu bisa menghitung total budget project?',
    );
    expect(res.intent).toBe('capability');
    expect(res.answer).toMatch(/dapat membantu|bisa/i);
    expect(res.answer).toMatch(/ACTIVE|ruang lingkup/i);
    expect(res.answer).not.toMatch(/Total Project\s*:/i);
    expect(res.toolTraces).toHaveLength(0);
  });

  it('BHV-003: "yang tadi" resolves finance context without unnecessary clarify', () => {
    const ctx = resolveSessionContext({
      message: 'Yang tadi budgetnya berapa?',
      priorUsers: [
        'Berdasarkan Finance Project saat ini, sudah ada berapa project yang tersedia saat ini?',
      ],
      lastAssistant:
        'Total Budget Finance Project (ACTIVE)\n• Total Project : 74\n• Project terbesar : SEG-2026-001 Alpha (Rp 1.000.000)',
      persistedTopic: 'finance',
      persistedObject: 'SEG-2026-001 Alpha',
    });
    expect(ctx.needsTopicClarify).toBe(false);
    expect(ctx.activeTopic).toBe('finance');
    expect(ctx.effectiveText).toMatch(/budget|SEG-2026-001/i);
  });

  it('BHV-003 V2: follow-up "yang tadi" stays on finance (no FAQ drift)', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const first = await ai.chat(
      user,
      'Berdasarkan Finance Project saat ini, sudah ada berapa project yang tersedia saat ini?',
    );
    const second = await ai.chat(user, 'Yang tadi.', first.conversationId);
    expect(second.answer).not.toMatch(/platform manajemen perizinan|Apa itu PermaTrax/i);
    expect(second.intent === 'data' || second.answer.match(/Budget|Project|Rp/i)).toBeTruthy();
  });

  it('BHV-001 V2: after correction, next turn stays on finance topic', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn(async () => [
      { code: 'SEG-1', name: 'Demo A', status: 'ACTIVE', totalBudget: 1000000 },
    ]);
    (prisma as any).financeProject.count = jest.fn(async ({ where }: any) => {
      if (where?.status === 'ACTIVE') return 18;
      if (where?.status === 'CLOSED') return 3;
      if (where?.status === 'ARCHIVED') return 2;
      return 21;
    });
    const { ai } = makeServices(prisma);
    const miss = await ai.chat(user, 'Cari project XYZ-NOTEXIST budgetnya berapa?');
    const corr = await ai.chat(
      user,
      'Tapi aku lihat di dalam Finance Projects ada banyak project loh.',
      miss.conversationId,
    );
    expect(corr.intent).toBe('correction');
    expect(corr.answer).toMatch(/lebih luas|ACTIVE|CLOSED/i);
    const follow = await ai.chat(user, 'Yang tadi detailnya?', corr.conversationId);
    expect(follow.answer).not.toMatch(/platform manajemen perizinan/i);
    expect(follow.answer).not.toMatch(/Purchase Request \(PR\) dibuat/i);
  });

  it('BHV-007 V2: empty search uses retrieval_failed, not overview FAQ', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn().mockResolvedValue([]);
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Cari project NamaMustahilXYZ999 budgetnya berapa?');
    expect(res.answer).not.toMatch(/platform manajemen perizinan/i);
    expect(res.answer).toMatch(
      /tidak berhasil|belum tersedia|perbedaan filter|lebih luas|ACTIVE|CLOSED|Non-ARCHIVED|retrieval|nama/i,
    );
  });

  it('BHV-004: ambiguous + Closed/Archived scope asks clarification', async () => {
    expect(isAmbiguousQuery('Budget project.')).toBe(true);
    expect(
      needsScopeClarification(
        'Tampilkan seluruh Finance Project termasuk Closed dan Archived.',
      ),
    ).toBe(true);
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const ambiguous = await ai.chat(user, 'Budget project.');
    expect(ambiguous.intent).toBe('clarify');
    expect(ambiguous.answer).toMatch(/yang mana|Misalnya/i);

    const scope = await ai.chat(
      user,
      'Tampilkan seluruh Finance Project termasuk Closed dan Archived.',
    );
    expect(scope.intent).toBe('clarify');
    expect(scope.answer).toMatch(/ACTIVE|Closed|Archived|opsi/i);
    expect(scope.toolTraces).toHaveLength(0);
  });

  it('BHV-005: recovery changes strategy (scope verification)', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const first = await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
    );
    const second = await ai.chat(
      user,
      'Bukan itu maksud saya.',
      first.conversationId,
    );
    expect(second.intent).toBe('recovery');
    expect(second.answer).not.toBe(first.answer);
    expect(second.answer).toMatch(/ACTIVE|seluruh|salah memahami|koreksi/i);
    expect(second.answer).not.toMatch(/Total Project\s*:\s*18/i);
  });

  // --- PAI Enhancement V3 (RSN-001 … 004) ---

  it('RSN-002: explicit module switch acks Active Module (not Guide fallback)', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const fin = await ai.chat(user, 'Aku mau bahas Finance Project.');
    expect(fin.answer).toMatch(/Active Module|Finance Project/i);
    expect(fin.answer).not.toMatch(/belum tersedia dalam knowledge|Guide/i);

    const proc = await ai.chat(
      user,
      'Sekarang kita pindah bahas Procurement.',
      fin.conversationId,
    );
    expect(proc.answer).toMatch(/Procurement|Active Module/i);
    expect(proc.answer).not.toMatch(/belum tersedia dalam knowledge|Coba buka Guide/i);
  });

  it('RSN-001/003: soft feedback stays on Finance domain (no Cash Op / Visit)', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const q = await ai.chat(
      user,
      'Yang budget paling besar berapa?',
      start.conversationId,
    );
    expect(q.answer).toMatch(/budget|Top|terbesar|Rp|Project/i);
    expect(q.answer).not.toMatch(/Visit Request|Cash Operation|Clean List/i);

    const soft = await ai.chat(
      user,
      'Kayaknya datanya kurang sesuai.',
      q.conversationId,
    );
    expect(soft.intent === 'recovery' || soft.intent === 'correction').toBe(
      true,
    );
    expect(soft.answer).toMatch(/Finance|ACTIVE|seluruh|koreksi|memahami/i);
    expect(soft.answer).not.toMatch(/Visit Request|cara membuat Visit|Clean List/i);
    expect(soft.answer).not.toMatch(/platform manajemen perizinan/i);
  });

  it('RSN-003: "Coba pahami lagi" recovery stays on finance source', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
      start.conversationId,
    );
    const rec = await ai.chat(
      user,
      'Coba pahami lagi pertanyaanku.',
      start.conversationId,
    );
    expect(rec.intent).toBe('recovery');
    expect(rec.answer).toMatch(/Finance|ACTIVE|seluruh|koreksi|memahami/i);
    expect(rec.answer).not.toMatch(/Visit Request|Clean List/i);
  });

  it('RSN-004: PIC query uses live lookup, not finance summary fallback', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn().mockResolvedValue([
      {
        code: 'TEST-001',
        name: 'Test Project',
        status: 'ACTIVE',
        createdBy: { name: 'Budi PM', email: 'budi@x.com', role: 'PM_SENIOR' },
      },
    ]);
    (prisma as any).cleanList = {
      findMany: jest.fn().mockResolvedValue([]),
    };
    (prisma as any).permitCluster = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(7),
    };
    const { ai } = makeServices(prisma);
    const res = await ai.chat(user, 'Siapa PIC Project TEST-001?');
    expect(res.answer).toMatch(/PIC|Budi PM|penanggung jawab|owner/i);
    expect(res.answer).not.toMatch(/Total Project\s*:/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project/i);
    expect(res.answer).not.toMatch(/platform manajemen perizinan/i);
  });

  // --- PAI Enhancement V4 ---

  it('RSN-002 V4: stock "paling sedikit" returns data, not add-stock howto', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest.fn().mockResolvedValue([
      {
        code: 'BRG-01',
        name: 'Kabel FO',
        currentQty: 2,
        unit: 'roll',
        minStockQty: 5,
        category: 'Kabel',
      },
      {
        code: 'BRG-02',
        name: 'Connector',
        currentQty: 50,
        unit: 'pcs',
        minStockQty: 10,
        category: 'Aksesoris',
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    expect(start.answer).toMatch(/Active Module|Stok/i);
    const q = await ai.chat(
      user,
      'Barang yang paling sedikit.',
      start.conversationId,
    );
    expect(q.answer).toMatch(/paling sedikit|Kabel|BRG-01|currentQty|2/i);
    expect(q.answer).not.toMatch(/Tambah Barang|cara add stock|Cara add/i);
    const follow = await ai.chat(user, 'Yang tadi.', q.conversationId);
    expect(follow.answer).not.toMatch(/Tambah Barang|cara add stock/i);
    expect(follow.answer).toMatch(/stok|Kabel|BRG|paling sedikit/i);
  });

  it('RSN-003 V4: recovery refine uses ACTIVE, does not re-ask budget which', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
      start.conversationId,
    );
    const rec = await ai.chat(
      user,
      'Aku rasa kamu salah nangkep.',
      start.conversationId,
    );
    expect(rec.intent).toBe('recovery');
    const refined = await ai.chat(
      user,
      'Maksudku budget project ACTIVE.',
      start.conversationId,
    );
    expect(refined.answer).not.toMatch(/Budget project yang mana/i);
    expect(refined.answer).toMatch(/ACTIVE|Total Budget|Total Project|perbarui/i);
  });

  it('RSN-004 V4: meta reasoning does not dump project/finance data', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
      start.conversationId,
    );
    const meta = await ai.chat(
      user,
      'Bagaimana kamu menghitung budget tadi?',
      start.conversationId,
    );
    expect(meta.intent).toBe('meta');
    expect(meta.answer).toMatch(/database|tool|Active Module|menghitung|ambil/i);
    expect(meta.answer).not.toMatch(/Total Project\s*:/i);
    expect(meta.toolTraces).toHaveLength(0);

    const unsure = await ai.chat(
      user,
      'Kalau kamu belum yakin.',
      start.conversationId,
    );
    expect(unsure.intent).toBe('meta');
    expect(unsure.answer).toMatch(/yakin|eksplisit|mengarang/i);
    expect(unsure.answer).not.toMatch(/Total Budget Finance Project/i);
  });

  // --- PAI Enhancement V5 ---

  it('RSN-002 V5: "yang tadi jumlahnya" resolves Active Reference, not full stock list', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest.fn().mockResolvedValue([
      {
        code: 'BRG-01',
        name: 'Kabel FO',
        currentQty: 2,
        unit: 'roll',
        minStockQty: 5,
        category: 'Kabel',
      },
      {
        code: 'BRG-02',
        name: 'Connector',
        currentQty: 50,
        unit: 'pcs',
        minStockQty: 10,
        category: 'Aksesoris',
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    const q = await ai.chat(
      user,
      'Barang yang stoknya paling sedikit.',
      start.conversationId,
    );
    expect(q.answer).toMatch(/BRG-01|Kabel FO|paling sedikit/i);
    const detail = await ai.chat(
      user,
      'Yang tadi jumlahnya berapa?',
      start.conversationId,
    );
    expect(detail.answer).toMatch(/BRG-01|Kabel FO|2\s*roll|Jumlahnya/i);
    expect(detail.answer).not.toMatch(/1\.\s*BRG-01[\s\S]*2\.\s*BRG-02/i);
    expect(detail.toolTraces).toHaveLength(0);
  });

  it('RSN-003 V5: recovery merges SITE constraint onto prior top-budget intent', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest
      .fn()
      .mockImplementation(async ({ where }: any) => {
        if (where?.hierarchyLevel === 'SITE') {
          return [
            {
              code: 'SITE-2026-001',
              name: 'Site Alpha',
              totalBudget: 900000000,
              materialSpent: 100000000,
              jasaSpent: 50000000,
              status: 'ACTIVE',
              hierarchyLevel: 'SITE',
            },
            {
              code: 'SITE-2026-002',
              name: 'Site Beta',
              totalBudget: 400000000,
              materialSpent: 20000000,
              jasaSpent: 10000000,
              status: 'ACTIVE',
              hierarchyLevel: 'SITE',
            },
          ];
        }
        return [
          {
            code: 'SEG-2026-042',
            name: 'Segment Big',
            totalBudget: 5000000000,
            materialSpent: 100000000,
            jasaSpent: 50000000,
            status: 'ACTIVE',
            hierarchyLevel: 'SEGMENT',
          },
        ];
      });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const top = await ai.chat(user, 'Yang terbesar.', start.conversationId);
    expect(top.answer).toMatch(/Top 10|terbesar|SEG-2026-042/i);
    await ai.chat(user, 'Bukan itu', start.conversationId);
    const refined = await ai.chat(
      user,
      'Aku maksud berdasarkan SITE.',
      start.conversationId,
    );
    expect(refined.answer).toMatch(/SITE|Site Alpha|berdasarkan|hierarki|SITE saja/i);
    expect(refined.answer).toMatch(/SITE-2026-001|Site Alpha/i);
    expect(refined.answer).not.toMatch(/Budget project yang mana/i);
    expect(refined.answer).not.toMatch(/Apakah yang dimaksud seluruh Finance/i);
  });

  it('RSN-004 V5: "kalau datanya memang tidak ada" is meta, not recovery clarify', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
      start.conversationId,
    );
    const missing = await ai.chat(
      user,
      'Kalau datanya memang tidak ada?',
      start.conversationId,
    );
    expect(missing.intent).toBe('meta');
    expect(missing.answer).toMatch(/tidak ada|kosong|belum tersedia|eksplisit/i);
    expect(missing.answer).not.toMatch(
      /Apakah yang dimaksud seluruh Finance Project atau hanya ACTIVE/i,
    );
    expect(missing.answer).not.toMatch(/Total Budget Finance Project/i);
    expect(missing.toolTraces).toHaveLength(0);
  });

  // --- PAI Enhancement V6 ---

  it('RSN-002 V6: ordinal "yang kedua" + satuan resolves Active Object, no full re-list', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest.fn().mockResolvedValue([
      {
        code: 'BRG-01',
        name: 'Kabel FO',
        currentQty: 2,
        unit: 'roll',
        minStockQty: 5,
        category: 'Kabel',
      },
      {
        code: 'BRG-02',
        name: 'Connector',
        currentQty: 50,
        unit: 'pcs',
        minStockQty: 10,
        category: 'Aksesoris',
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    await ai.chat(
      user,
      'Barang yang stoknya paling sedikit.',
      start.conversationId,
    );
    const second = await ai.chat(
      user,
      'Yang kedua satuannya apa?',
      start.conversationId,
    );
    expect(second.answer).toMatch(/BRG-02|Connector|pcs|Satuan/i);
    expect(second.answer).not.toMatch(/1\.\s*BRG-01[\s\S]*2\.\s*BRG-02/i);
    expect(second.toolTraces).toHaveLength(0);
  });

  it('RSN-003 V6: "Bukan itu. Aku maksud SITE." merges constraint inline (no re-clarify)', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest
      .fn()
      .mockImplementation(async ({ where }: any) => {
        if (where?.hierarchyLevel === 'SITE') {
          return [
            {
              code: 'SITE-2026-001',
              name: 'Site Alpha',
              totalBudget: 900000000,
              materialSpent: 100000000,
              jasaSpent: 50000000,
              status: 'ACTIVE',
              hierarchyLevel: 'SITE',
            },
          ];
        }
        return [
          {
            code: 'SEG-2026-042',
            name: 'Segment Big',
            totalBudget: 5000000000,
            materialSpent: 100000000,
            jasaSpent: 50000000,
            status: 'ACTIVE',
            hierarchyLevel: 'SEGMENT',
          },
        ];
      });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(user, 'Yang budget terbesar.', start.conversationId);
    const refined = await ai.chat(
      user,
      'Bukan itu. Aku maksud SITE.',
      start.conversationId,
    );
    expect(refined.answer).not.toMatch(/Budget project yang mana/i);
    expect(refined.answer).toMatch(/SITE|Site Alpha|hierarki|SITE saja/i);
    expect(refined.answer).toMatch(/SITE-2026-001|Site Alpha/i);
  });

  it('RSN-004 V6: "kalau kamu tidak tahu" / "datanya kosong" are meta, not FAQ/Guide', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
      start.conversationId,
    );
    const dunno = await ai.chat(
      user,
      'Kalau kamu tidak tahu?',
      start.conversationId,
    );
    expect(dunno.intent).toBe('meta');
    expect(dunno.answer).toMatch(/tidak tahu|ragu|eksplisit|kosong|mengarang/i);
    expect(dunno.answer).not.toMatch(/platform manajemen perizinan|Apa itu Finance/i);
    expect(dunno.toolTraces).toHaveLength(0);

    const empty = await ai.chat(
      user,
      'Kalau datanya kosong?',
      start.conversationId,
    );
    expect(empty.intent).toBe('meta');
    expect(empty.answer).toMatch(/kosong|tidak ada|belum tersedia|eksplisit/i);
    expect(empty.answer).not.toMatch(/User Guide|Cara menggunakan|sidebar/i);
    expect(empty.toolTraces).toHaveLength(0);
  });

  // --- PAI P0–P3 golden suite ---

  it('P0: sessionState persisted on AiConversation after reply', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    expect(prisma.aiConversation.update).toHaveBeenCalled();
    const updateCalls = (prisma.aiConversation.update as jest.Mock).mock.calls;
    const withState = updateCalls.find(
      (c: any) => c[0]?.data?.sessionState?.activeTopic === 'stock',
    );
    expect(withState).toBeTruthy();
    expect(start.conversationId).toBeTruthy();
  });

  it('P0: Active Constraint Set merges SITE across recovery turns', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest
      .fn()
      .mockImplementation(async ({ where }: any) => {
        if (where?.hierarchyLevel === 'SITE') {
          return [
            {
              code: 'SITE-2026-001',
              name: 'Site Alpha',
              totalBudget: 900000000,
              materialSpent: 0,
              jasaSpent: 0,
              status: 'ACTIVE',
              hierarchyLevel: 'SITE',
            },
          ];
        }
        return [
          {
            code: 'SEG-1',
            name: 'Seg',
            totalBudget: 1e9,
            materialSpent: 0,
            jasaSpent: 0,
            status: 'ACTIVE',
            hierarchyLevel: 'SEGMENT',
          },
        ];
      });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(user, 'Yang terbesar.', start.conversationId);
    const refined = await ai.chat(
      user,
      'Bukan itu. Aku maksud SITE.',
      start.conversationId,
    );
    expect(refined.answer).toMatch(/SITE|Site Alpha/i);
    expect(refined.answer).not.toMatch(/Budget project yang mana/i);
  });

  it('P1: visit requestor live lookup does not dump finance', async () => {
    const prisma = makePrisma();
    (prisma as any).visitRequest.findMany = jest.fn().mockResolvedValue([
      {
        id: 'vr1',
        status: 'APPROVED_PENDING_DATA',
        ispCustomer: 'ISP A',
        requester: { name: 'Ani Survey', role: 'SURVEYOR' },
        cleanList: { rwCode: 'RW-01' },
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Visit Request.');
    const res = await ai.chat(
      user,
      'Siapa requestor visit RW-01?',
      start.conversationId,
    );
    expect(res.answer).toMatch(/Ani Survey|requestor/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project/i);
  });

  it('P2 golden: stock rank → ordinal attribute → finance meta empty', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest.fn().mockResolvedValue([
      {
        code: 'A1',
        name: 'Item A',
        currentQty: 1,
        unit: 'pcs',
        minStockQty: 2,
        category: 'X',
      },
      {
        code: 'B2',
        name: 'Item B',
        currentQty: 9,
        unit: 'meter',
        minStockQty: 1,
        category: 'Y',
      },
    ]);
    const { ai } = makeServices(prisma);
    const s = await ai.chat(user, 'Aku mau bahas Stock.');
    await ai.chat(user, 'Barang yang stoknya paling sedikit.', s.conversationId);
    const attr = await ai.chat(
      user,
      'Yang kedua satuannya apa?',
      s.conversationId,
    );
    expect(attr.answer).toMatch(/B2|Item B|meter|Satuan/i);
    expect(attr.toolTraces).toHaveLength(0);

    const fin = await ai.chat(user, 'Sekarang kita bahas Finance Project.', s.conversationId);
    expect(fin.answer).toMatch(/Active Module|Finance/i);
    await ai.chat(
      user,
      'Berapa nominal total budget project aktif saat ini?',
      s.conversationId,
    );
    const meta = await ai.chat(
      user,
      'Kalau datanya kosong?',
      s.conversationId,
    );
    expect(meta.intent).toBe('meta');
    expect(meta.answer).not.toMatch(/Total Budget Finance Project/i);
  });

  // --- UET Round 4: Stock / Cash / Visit recovery ---

  it('Round 4: refineRecoveryQuery covers stock, cash, visit', () => {
    expect(
      refineRecoveryQuery(
        'Bukan itu. Maksudku paling banyak.',
        'stock',
        'Barang yang stoknya paling sedikit',
      ),
    ).toMatch(/paling banyak/i);
    expect(
      refineRecoveryQuery(
        'Bukan itu. Maksudku yang masih pending.',
        'cash',
        'Kapan terakhir dana cair?',
      ),
    ).toMatch(/pending/i);
    expect(
      refineRecoveryQuery(
        'Bukan itu. Maksudku siapa requestornya.',
        'visit',
        'Berapa visit request open?',
      ),
    ).toMatch(/requestor/i);
  });

  it('Round 4: stock recovery switches paling sedikit → paling banyak', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest
      .fn()
      .mockImplementation(async ({ orderBy }: any) => {
        const low = {
          code: 'LOW-1',
          name: 'Item Low',
          currentQty: 1,
          unit: 'pcs',
          minStockQty: 5,
          category: 'A',
        };
        const high = {
          code: 'HIGH-9',
          name: 'Item High',
          currentQty: 99,
          unit: 'pcs',
          minStockQty: 1,
          category: 'B',
        };
        if (orderBy?.currentQty === 'asc') return [low, high];
        if (orderBy?.currentQty === 'desc') return [high, low];
        return [low, high];
      });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    const low = await ai.chat(
      user,
      'Barang yang stoknya paling sedikit.',
      start.conversationId,
    );
    expect(low.answer).toMatch(/LOW-1|Item Low|paling sedikit/i);
    const recovered = await ai.chat(
      user,
      'Bukan itu. Maksudku paling banyak.',
      start.conversationId,
    );
    expect(recovered.answer).toMatch(/HIGH-9|Item High|paling banyak/i);
    expect(recovered.answer).not.toMatch(/Tambah Barang|cara add stock/i);
  });

  it('Round 4: cash recovery switches last disburse → pending approvals', async () => {
    const prisma = makePrisma();
    (prisma as any).cashOperationRequest.findFirst = jest.fn().mockResolvedValue({
      requestNumber: 'CO-LAST-1',
      type: 'OPERATIONAL',
      status: 'DISBURSED',
      description: 'Ops last',
      amount: 1000000,
      finalApprovedAmount: 1000000,
      disbursedAmount: 1000000,
      disbursedAt: new Date('2026-07-01T10:00:00Z'),
      projectRef: null,
      category: null,
      financeProject: null,
      requester: { name: 'Budi', role: 'FINANCE' },
    });
    (prisma as any).cashOperationRequest.findMany = jest.fn().mockResolvedValue([
      {
        requestNumber: 'CO-PEND-2',
        type: 'OPERATIONAL',
        status: 'PENDING_APPROVAL',
        description: 'Pending ops',
        amount: 500000,
        updatedAt: new Date('2026-07-20T10:00:00Z'),
        requester: { name: 'Siti', role: 'FINANCE' },
      },
    ]);
    (prisma as any).ftttTransaction.findFirst = jest.fn().mockResolvedValue(null);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Cash Operation.');
    const last = await ai.chat(
      user,
      'Kapan terakhir dana cair / disbursement?',
      start.conversationId,
    );
    expect(last.answer).toMatch(/CO-LAST-1|cair|disburse/i);
    const recovered = await ai.chat(
      user,
      'Bukan itu. Maksudku yang masih pending.',
      start.conversationId,
    );
    expect(recovered.answer).toMatch(/CO-PEND-2|pending|Siti/i);
    expect(recovered.answer).not.toMatch(/Total Budget Finance Project/i);
  });

  it('Round 4: visit recovery switches to requestor live lookup', async () => {
    const prisma = makePrisma();
    (prisma as any).visitRequest.count = jest.fn().mockResolvedValue(3);
    (prisma as any).visitRequest.findMany = jest.fn().mockResolvedValue([
      {
        id: 'vr-r4',
        status: 'APPROVED_PENDING_DATA',
        ispCustomer: 'ISP Round4',
        requester: { name: 'Dewi Requestor', role: 'SURVEYOR' },
        cleanList: { rwCode: 'RW-99' },
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Visit Request.');
    await ai.chat(
      user,
      'Berapa visit request saya yang masih open?',
      start.conversationId,
    );
    const recovered = await ai.chat(
      user,
      'Bukan itu. Maksudku siapa requestornya.',
      start.conversationId,
    );
    expect(recovered.answer).toMatch(/Dewi Requestor|requestor/i);
    expect(recovered.answer).not.toMatch(/Total Budget Finance Project/i);
  });

  // --- PAI Enhancement V7 (CSM-002) ---

  it('CSM-002 V7: Top 10 → Yang kedua → Status/Realisasi keeps Active Object (no re-list)', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn().mockResolvedValue([
      {
        code: 'SEG-2026-001',
        name: 'Alpha',
        totalBudget: 5000000000,
        materialSpent: 100000000,
        jasaSpent: 50000000,
        materialBudget: 2000000000,
        jasaBudget: 1000000000,
        status: 'ACTIVE',
        hierarchyLevel: 'SEGMENT',
        isOverbudget: false,
      },
      {
        code: 'SEG-2026-002',
        name: 'Beta',
        totalBudget: 4000000000,
        materialSpent: 200000000,
        jasaSpent: 100000000,
        materialBudget: 1500000000,
        jasaBudget: 800000000,
        status: 'ACTIVE',
        hierarchyLevel: 'SEGMENT',
        isOverbudget: false,
      },
      {
        code: 'SEG-2026-003',
        name: 'Gamma',
        totalBudget: 3000000000,
        materialSpent: 50000000,
        jasaSpent: 25000000,
        materialBudget: 900000000,
        jasaBudget: 400000000,
        status: 'ACTIVE',
        hierarchyLevel: 'SEGMENT',
        isOverbudget: false,
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const list = await ai.chat(
      user,
      'Top 10 Budget terbesar.',
      start.conversationId,
    );
    expect(list.answer).toMatch(/SEG-2026-001|Alpha/i);
    expect(list.answer).toMatch(/1\.\s*SEG-2026-001[\s\S]*2\.\s*SEG-2026-002/i);

    const second = await ai.chat(user, 'Yang kedua.', start.conversationId);
    expect(second.answer).toMatch(/SEG-2026-002|Beta/i);
    expect(second.answer).not.toMatch(/1\.\s*SEG-2026-001[\s\S]*2\.\s*SEG-2026-002[\s\S]*3\./i);
    expect(second.toolTraces).toHaveLength(0);

    const status = await ai.chat(user, 'Statusnya.', start.conversationId);
    expect(status.answer).toMatch(/SEG-2026-002|Beta|ACTIVE|Status/i);
    expect(status.answer).not.toMatch(/1\.\s*SEG-2026-001[\s\S]*2\.\s*SEG-2026-002[\s\S]*3\./i);

    const realisasi = await ai.chat(
      user,
      'Realisasinya.',
      start.conversationId,
    );
    expect(realisasi.answer).toMatch(/SEG-2026-002|Beta|realisasi/i);
    expect(realisasi.toolTraces).toHaveLength(0);
  });

  it('CSM-002 V7: Active Dataset lock — SEGMENT list not swapped to ALL on ordinal', async () => {
    const prisma = makePrisma();
    let lastHierarchy: string | undefined;
    (prisma as any).financeProject.findMany = jest
      .fn()
      .mockImplementation(async ({ where }: any) => {
        lastHierarchy = where?.hierarchyLevel;
        if (where?.hierarchyLevel === 'SEGMENT') {
          return [
            {
              code: 'SEG-2026-010',
              name: 'Seg Only',
              totalBudget: 8000000000,
              materialSpent: 1,
              jasaSpent: 1,
              status: 'ACTIVE',
              hierarchyLevel: 'SEGMENT',
            },
            {
              code: 'SEG-2026-011',
              name: 'Seg Two',
              totalBudget: 7000000000,
              materialSpent: 1,
              jasaSpent: 1,
              status: 'ACTIVE',
              hierarchyLevel: 'SEGMENT',
            },
          ];
        }
        return [
          {
            code: 'SITE-2026-999',
            name: 'Should Not Appear',
            totalBudget: 99999999999,
            materialSpent: 1,
            jasaSpent: 1,
            status: 'ACTIVE',
            hierarchyLevel: 'SITE',
          },
        ];
      });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    await ai.chat(
      user,
      'Top 10 Budget terbesar berdasarkan SEGMENT.',
      start.conversationId,
    );
    expect(lastHierarchy).toBe('SEGMENT');
    const callsBefore = (prisma as any).financeProject.findMany.mock.calls.length;
    const second = await ai.chat(user, 'Yang kedua.', start.conversationId);
    const callsAfter = (prisma as any).financeProject.findMany.mock.calls.length;
    expect(callsAfter).toBe(callsBefore); // no re-retrieval
    expect(second.answer).toMatch(/SEG-2026-011|Seg Two/i);
    expect(second.answer).not.toMatch(/SITE-2026-999|Should Not Appear/i);
  });

  it('CSM-002 V7: explicit entity then attribute keeps Active Object', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn().mockResolvedValue([
      {
        code: 'SEG-2026-005',
        name: 'Explicit Project',
        totalBudget: 2500000000,
        materialBudget: 1200000000,
        jasaBudget: 500000000,
        materialSpent: 300000000,
        jasaSpent: 100000000,
        status: 'ACTIVE',
        hierarchyLevel: 'SEGMENT',
        isOverbudget: false,
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const detail = await ai.chat(
      user,
      'SEG-2026-005',
      start.conversationId,
    );
    expect(detail.answer).toMatch(/SEG-2026-005|Explicit Project/i);
    const material = await ai.chat(
      user,
      'Material budgetnya.',
      start.conversationId,
    );
    expect(material.answer).toMatch(/SEG-2026-005|Material|1\.200\.000\.000|1200000000/i);
    expect(material.answer).not.toMatch(/Total Budget Finance Project\s*\(/i);
  });

  it('CSM-002 V7: "Barang ketiga apa?" stays data, not Guide', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest.fn().mockResolvedValue([
      {
        code: 'A1',
        name: 'Item A',
        currentQty: 1,
        unit: 'pcs',
        minStockQty: 2,
        category: 'X',
      },
      {
        code: 'B2',
        name: 'Item B',
        currentQty: 5,
        unit: 'pcs',
        minStockQty: 1,
        category: 'Y',
      },
      {
        code: 'C3',
        name: 'Item C',
        currentQty: 9,
        unit: 'meter',
        minStockQty: 1,
        category: 'Z',
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    await ai.chat(
      user,
      'Barang yang stoknya paling sedikit.',
      start.conversationId,
    );
    const third = await ai.chat(
      user,
      'Barang ketiga apa?',
      start.conversationId,
    );
    expect(third.intent).toBe('data');
    expect(third.answer).toMatch(/C3|Item C/i);
    expect(third.answer).not.toMatch(/Tambah Barang|cara add stock|Cara add/i);
    expect(third.toolTraces).toHaveLength(0);
  });

  it('CSM-002 V7: Yang terakhir resolves last ranked item', async () => {
    const prisma = makePrisma();
    (prisma as any).stockItem.findMany = jest.fn().mockResolvedValue([
      {
        code: 'S1',
        name: 'First',
        currentQty: 1,
        unit: 'pcs',
        minStockQty: 1,
        category: 'A',
      },
      {
        code: 'S2',
        name: 'Second',
        currentQty: 2,
        unit: 'pcs',
        minStockQty: 1,
        category: 'A',
      },
      {
        code: 'S3',
        name: 'LastOne',
        currentQty: 3,
        unit: 'pcs',
        minStockQty: 1,
        category: 'A',
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Stock.');
    await ai.chat(
      user,
      'Barang yang stoknya paling sedikit.',
      start.conversationId,
    );
    const last = await ai.chat(user, 'Yang terakhir.', start.conversationId);
    expect(last.answer).toMatch(/S3|LastOne/i);
    expect(last.toolTraces).toHaveLength(0);
  });

  // --- PAI Enhancement V8 (FNC-001 … FNC-005) ---

  it('FNC-001/002: Berapa ACTIVE? returns status count, not Finance Summary', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.count = jest.fn(async ({ where }: any) => {
      if (where?.status === 'ACTIVE') return 74;
      if (where?.status === 'CLOSED') return 2;
      return 0;
    });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(user, 'Berapa ACTIVE?', start.conversationId);
    expect(res.intent).toBe('data');
    expect(res.answer).toMatch(/ACTIVE Project\s*[–-]\s*74/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project/i);
    expect(res.answer).not.toMatch(/Budget project yang mana/i);
  });

  it('FNC-001/002: Ada over budget? returns aggregate count, not clarify', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.count = jest.fn(async ({ where }: any) => {
      if (where?.isOverbudget) return 0;
      return 18;
    });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(user, 'Ada over budget?', start.conversationId);
    expect(['data', 'analytics']).toContain(res.intent);
    expect(res.answer).toMatch(/Over Budget\s*[–-]\s*0/i);
    expect(res.answer).not.toMatch(/Budget project yang mana/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project/i);
  });

  it('FNC-001/002: Material Budget? returns material aggregate, not summary dump', async () => {
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(user, 'Material Budget?', start.conversationId);
    expect(res.intent).toBe('data');
    expect(res.answer).toMatch(/Material Budget/i);
    expect(res.answer).toMatch(/Rp|8\.000|8000000000/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project \(/i);
  });

  it('FNC-003: search by project name / partial keyword (not code-only)', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn(async ({ where }: any) => {
      const or = where?.OR as Array<Record<string, any>> | undefined;
      const hit = or?.some(
        (c) =>
          c?.name?.contains?.toLowerCase?.().includes('alpha') ||
          c?.description?.contains?.toLowerCase?.().includes('alpha') ||
          c?.parent?.name?.contains?.toLowerCase?.().includes('alpha'),
      );
      if (hit || where?.AND) {
        return [
          {
            code: 'SEG-2026-009',
            name: 'Alpha Cluster West',
            description: 'Site Alpha area',
            totalBudget: 1200000000,
            materialBudget: 700000000,
            jasaBudget: 500000000,
            materialSpent: 100000000,
            jasaSpent: 50000000,
            status: 'ACTIVE',
            hierarchyLevel: 'SEGMENT',
            isOverbudget: false,
            poCustomerNumber: 'PO-ALPHA-1',
            parent: null,
          },
        ];
      }
      return [];
    });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(user, 'Cari project Alpha', start.conversationId);
    expect(res.intent).toBe('data');
    expect(res.answer).toMatch(/Alpha Cluster West|SEG-2026-009/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project \(/i);
  });

  it('FNC-003: empty business search does not become Finance Summary', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn().mockResolvedValue([]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(
      user,
      'Cari project NamaTidakAdaXYZ',
      start.conversationId,
    );
    expect(res.answer).toMatch(/tidak ditemukan|kata kunci/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project \(/i);
    expect(res.answer).not.toMatch(/Pencarian nama spesifik kosong/i);
  });

  it('FNC-004: realisasi terbesar ranks by realization, not totalBudget only', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn().mockResolvedValue([
      {
        code: 'A1',
        name: 'Low Realisasi High Budget',
        totalBudget: 9000000000,
        materialBudget: 1,
        jasaBudget: 1,
        materialSpent: 1000000,
        jasaSpent: 0,
        status: 'ACTIVE',
        hierarchyLevel: 'SITE',
        isOverbudget: false,
      },
      {
        code: 'B2',
        name: 'High Realisasi',
        totalBudget: 2000000000,
        materialBudget: 1,
        jasaBudget: 1,
        materialSpent: 1500000000,
        jasaSpent: 400000000,
        status: 'ACTIVE',
        hierarchyLevel: 'SEGMENT',
        isOverbudget: false,
      },
    ]);
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(
      user,
      'Top realisasi terbesar',
      start.conversationId,
    );
    expect(res.answer).toMatch(/Realisasi terbesar/i);
    expect(res.answer.indexOf('B2')).toBeLessThan(res.answer.indexOf('A1'));
  });

  it('FNC-005: ACTIVE SITE multi-filter runs finance analytics, not Guide', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.count = jest.fn(async ({ where }: any) => {
      if (where?.status === 'ACTIVE' && where?.hierarchyLevel === 'SITE') return 11;
      if (where?.hierarchyLevel === 'SITE') return 11;
      return 18;
    });
    (prisma as any).financeProject.aggregate = jest.fn().mockResolvedValue({
      _sum: {
        totalBudget: 1000000000,
        materialBudget: 600000000,
        jasaBudget: 400000000,
        materialSpent: 100000000,
        jasaSpent: 50000000,
      },
      _count: 11,
    });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(user, 'ACTIVE SITE', start.conversationId);
    expect(res.intent).toBe('data');
    expect(res.toolTraces.some((t) => t.name === 'finance_analytics')).toBe(true);
    expect(res.answer).toMatch(/SITE|Total Project|11/i);
    expect(res.answer).not.toMatch(/User Guide|Apa itu Finance Project/i);
  });

  // --- PAI Enhancement V9 ---

  it('FNC-002 V9: total project count is non-ARCHIVED, not forced ACTIVE', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.count = jest.fn(async ({ where }: any) => {
      if (where?.status === 'ACTIVE') return 74;
      if (where?.status?.not === 'ARCHIVED') return 99;
      return 99;
    });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(user, 'Berapa total project?', start.conversationId);
    expect(detectFinanceMode('Berapa total project?')).toBe('project_count');
    expect(res.answer).toMatch(/Total Project\s*[–-]\s*99/i);
    expect(res.answer).toMatch(/non-ARCHIVED/i);
    expect(res.answer).not.toMatch(/ACTIVE Project\s*[–-]\s*74/i);
  });

  it('FNC-002 V9: multi-metric budget + realisasi', async () => {
    expect(detectFinanceMetrics('Total budget dan realisasinya berapa?')).toEqual(
      expect.arrayContaining(['total_budget', 'realization']),
    );
    const prisma = makePrisma();
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(
      user,
      'Total budget dan realisasinya berapa?',
      start.conversationId,
    );
    expect(res.answer).toMatch(/Total Budget/i);
    expect(res.answer).toMatch(/Total Realisasi/i);
    expect(res.answer).not.toMatch(/Total Budget Finance Project \(/i);
  });

  it('FNC-004 V9: Top N limit and ASC direction', () => {
    expect(detectTopNLimit('Top 5 budget terkecil')).toBe(5);
    expect(detectFinanceMode('Top 5 budget terkecil')).toBe('smallest');
  });

  it('FNC-005 V9: ACTIVE SITE + realisasi ranking', async () => {
    const prisma = makePrisma();
    (prisma as any).financeProject.findMany = jest.fn(async ({ where }: any) => {
      expect(where?.status).toBe('ACTIVE');
      expect(where?.hierarchyLevel).toBe('SITE');
      return [
        {
          code: 'S1',
          name: 'Site Low',
          totalBudget: 5000000000,
          materialBudget: 1,
          jasaBudget: 1,
          materialSpent: 10000000,
          jasaSpent: 0,
          status: 'ACTIVE',
          hierarchyLevel: 'SITE',
          isOverbudget: false,
        },
        {
          code: 'S2',
          name: 'Site High',
          totalBudget: 1000000000,
          materialBudget: 1,
          jasaBudget: 1,
          materialSpent: 800000000,
          jasaSpent: 100000000,
          status: 'ACTIVE',
          hierarchyLevel: 'SITE',
          isOverbudget: false,
        },
      ];
    });
    const { ai } = makeServices(prisma);
    const start = await ai.chat(user, 'Aku mau bahas Finance Project.');
    const res = await ai.chat(
      user,
      'Top 5 ACTIVE SITE realisasi terbesar',
      start.conversationId,
    );
    expect(res.answer).toMatch(/Top 5.*Realisasi terbesar/i);
    expect(res.answer.indexOf('S2')).toBeLessThan(res.answer.indexOf('S1'));
  });
});