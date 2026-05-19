-- Insert BUDGET_INIT for GENERAL project if not exists
INSERT INTO "BudgetLedger" (
  id, "financeProjectId", "entryType", "category", amount,
  "sourceType", "sourceId", notes, metadata, "createdById", "createdAt"
)
SELECT
  'clseedledgergeneral0001',
  fp.id,
  'BUDGET_INIT',
  NULL,
  0,
  'MANUAL_ADJUSTMENT',
  fp.id,
  'Initial seed entry for GENERAL/UNCATEGORIZED bucket',
  jsonb_build_object(
    'isSeed', true,
    'previousValues', jsonb_build_object('totalBudget', 0, 'materialBudget', NULL, 'jasaBudget', NULL),
    'newValues', jsonb_build_object('totalBudget', 0, 'materialBudget', NULL, 'jasaBudget', NULL)
  ),
  fp."createdById",
  NOW()
FROM "FinanceProject" fp
WHERE fp."isDefaultUncategorized" = true
  AND NOT EXISTS (
    SELECT 1 FROM "BudgetLedger" bl
    WHERE bl."financeProjectId" = fp.id
      AND bl."entryType" = 'BUDGET_INIT'
  );
