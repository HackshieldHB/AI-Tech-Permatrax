#!/bin/bash
# NEW: Production migration script — run this on deploy

set -e

echo "=== PermaTrax Production Migration ==="
echo "Step 1: Running enum fix migration..."
npx tsx scripts/run-enum-migration.ts

echo "Step 2: Applying all Prisma migrations..."
npx prisma migrate deploy

echo "Step 3: Generating Prisma client..."
npx prisma generate

echo "Step 4: Running seed (upsert-safe)..."
npx tsx prisma/seed.ts

echo "=== Migration complete ==="
