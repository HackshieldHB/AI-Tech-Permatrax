import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMATRAX_KNOWLEDGE_SEED } from './ai-knowledge.seed';

export type RetrievedChunk = {
  chunkId: string;
  articleId: string;
  title: string;
  module: string;
  sourceUri: string | null;
  content: string;
  score: number;
};

export type RetrieveOptions = {
  topK?: number;
  /** Prefer these categories (boost + soft filter). Empty = all. */
  categories?: string[];
  /** Prefer these modules. */
  modules?: string[];
};

@Injectable()
export class AiKnowledgeService implements OnModuleInit {
  private readonly logger = new Logger(AiKnowledgeService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      await this.ensureSeeded();
    } catch (err) {
      this.logger.warn(
        `AI knowledge seed skipped (tables may not exist yet): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Upsert missing / outdated seed articles by slug so DEV gets new SOP/nav docs. */
  async ensureSeeded(): Promise<void> {
    let created = 0;
    let updated = 0;
    for (const article of PERMATRAX_KNOWLEDGE_SEED) {
      const existing = await this.prisma.aiKnowledgeArticle.findUnique({
        where: { slug: article.slug },
        include: { chunks: true },
      });
      if (!existing) {
        await this.prisma.aiKnowledgeArticle.create({
          data: {
            slug: article.slug,
            title: article.title,
            module: article.module,
            category: article.category,
            rolesAllowed: article.rolesAllowed,
            sourceUri: article.sourceUri,
            chunks: {
              create: article.chunks.map((c, i) => ({
                chunkIndex: i,
                content: c.content,
                keywords: c.keywords.toLowerCase(),
              })),
            },
          },
        });
        created += 1;
        continue;
      }

      const seedJoined = article.chunks.map((c) => c.content).join('\n');
      const dbJoined = existing.chunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((c) => c.content)
        .join('\n');
      if (
        existing.title === article.title &&
        existing.category === article.category &&
        seedJoined === dbJoined
      ) {
        continue;
      }

      await this.prisma.aiKnowledgeChunk.deleteMany({
        where: { articleId: existing.id },
      });
      await this.prisma.aiKnowledgeArticle.update({
        where: { id: existing.id },
        data: {
          title: article.title,
          module: article.module,
          category: article.category,
          rolesAllowed: article.rolesAllowed,
          sourceUri: article.sourceUri,
          chunks: {
            create: article.chunks.map((c, i) => ({
              chunkIndex: i,
              content: c.content,
              keywords: c.keywords.toLowerCase(),
            })),
          },
        },
      });
      updated += 1;
    }
    this.logger.log(
      `AI knowledge seed sync: ${created} created, ${updated} updated, ${PERMATRAX_KNOWLEDGE_SEED.length} total in seed`,
    );
  }

  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1);
  }

  async retrieve(
    query: string,
    role: string,
    topKOrOpts: number | RetrieveOptions = 5,
  ): Promise<RetrievedChunk[]> {
    const opts: RetrieveOptions =
      typeof topKOrOpts === 'number' ? { topK: topKOrOpts } : topKOrOpts;
    const topK = opts.topK ?? 5;
    const tokens = this.tokenize(query);
    if (tokens.length === 0) return [];

    const chunks = await this.prisma.aiKnowledgeChunk.findMany({
      where: { article: { isActive: true } },
      include: {
        article: {
          select: {
            id: true,
            title: true,
            module: true,
            category: true,
            sourceUri: true,
            rolesAllowed: true,
          },
        },
      },
      take: 500,
    });

    // PAI P2: hybrid BM25-lite — IDF over candidate set + TF in chunk
    const N = Math.max(chunks.length, 1);
    const df = new Map<string, number>();
    const docs = chunks.map((chunk) => {
      const hay =
        `${chunk.keywords} ${chunk.content} ${chunk.article.title}`.toLowerCase();
      const terms = new Set(this.tokenize(hay));
      for (const t of tokens) {
        if (terms.has(t) || hay.includes(t)) {
          df.set(t, (df.get(t) || 0) + 1);
        }
      }
      return { chunk, hay };
    });

    const k1 = 1.2;
    const b = 0.75;
    const avgdl =
      docs.reduce((s, d) => s + d.hay.split(/\s+/).length, 0) / N || 1;

    const scored: RetrievedChunk[] = [];
    for (const { chunk, hay } of docs) {
      const allowed = chunk.article.rolesAllowed;
      if (allowed.length > 0 && !allowed.includes(role)) continue;

      if (
        opts.categories?.length &&
        !opts.categories.includes(chunk.article.category)
      ) {
        continue;
      }
      if (
        opts.modules?.length &&
        !opts.modules.includes(chunk.article.module)
      ) {
        continue;
      }

      const dl = hay.split(/\s+/).length || 1;
      let score = 0;
      for (const t of tokens) {
        const tf = countOccurrences(hay, t);
        if (tf <= 0) continue;
        const idf = Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
        const tfNorm =
          (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (dl / avgdl)));
        score += idf * tfNorm;
        if (chunk.keywords.toLowerCase().includes(t)) score += 0.35;
        if (chunk.article.title.toLowerCase().includes(t)) score += 0.25;
      }
      if (score <= 0) continue;
      scored.push({
        chunkId: chunk.id,
        articleId: chunk.article.id,
        title: chunk.article.title,
        module: chunk.article.module,
        sourceUri: chunk.article.sourceUri,
        content: chunk.content,
        score,
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}

function countOccurrences(hay: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const found = hay.indexOf(term, idx);
    if (found < 0) break;
    count += 1;
    idx = found + term.length;
  }
  return count;
}
