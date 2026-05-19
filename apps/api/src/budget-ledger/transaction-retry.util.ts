import { Prisma } from '@prisma/client';

const SERIALIZATION_FAILURE = 'P2034';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type SerializablePrisma = {
  $transaction: (
    fn: (tx: Prisma.TransactionClient) => Promise<unknown>,
    options?: {
      isolationLevel?: Prisma.TransactionIsolationLevel;
      maxWait?: number;
      timeout?: number;
    },
  ) => Promise<unknown>;
};

/** Run a Serializable Prisma transaction with exponential backoff on P2034 (max 3 retries). */
export async function runSerializableTransaction<T>(
  prisma: SerializablePrisma,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const backoffMs = [50, 200, 500];
  let lastError: unknown;
  for (let attempt = 0; attempt <= backoffMs.length; attempt++) {
    try {
      const out = await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 10_000,
        timeout: 30_000,
      });
      return out as T;
    } catch (e) {
      lastError = e;
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === SERIALIZATION_FAILURE &&
        attempt < backoffMs.length
      ) {
        await sleep(backoffMs[attempt]);
        continue;
      }
      throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Serializable transaction failed');
}
