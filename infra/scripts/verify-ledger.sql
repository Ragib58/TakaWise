-- TakaWise ledger integrity & reconciliation checks (read-only).
-- Used after restores, migrations and incidents (docs/runbooks/backup-restore.md).
-- Every "violations" row must be 0; the fingerprint rows must match between
-- the source and the restored database.
\pset footer off
\pset tuples_only on
\pset format unaligned
\pset fieldsep '|'

-- 1. Journals that do not balance (Σdebit ≠ Σcredit) or have < 2 lines.
SELECT 'violations.unbalanced_journals', count(*) FROM (
  SELECT e.id FROM journal_entries e LEFT JOIN journal_lines l ON l.journal_entry_id = e.id
  GROUP BY e.id HAVING count(l.id) < 2 OR coalesce(sum(l.debit), 0) <> coalesce(sum(l.credit), 0)
) x;

-- 2. Lines that are not one-sided positive or not in their journal's currency.
SELECT 'violations.bad_lines', count(*) FROM journal_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
 WHERE NOT ((l.debit > 0 AND l.credit = 0) OR (l.credit > 0 AND l.debit = 0)) OR l.currency <> e.currency;

-- 3. Lines posted to another user's ledger account.
SELECT 'violations.cross_user_lines', count(*) FROM journal_lines l
  JOIN journal_entries e ON e.id = l.journal_entry_id
  JOIN ledger_accounts a ON a.id = l.ledger_account_id
 WHERE a.user_id <> e.user_id;

-- 4. Transactions whose amount differs from their journal, or whose reversal is inconsistent.
SELECT 'violations.transaction_journal_mismatch', count(*) FROM transactions t
 WHERE t.amount <> (SELECT sum(l.debit) FROM journal_lines l WHERE l.journal_entry_id = t.journal_entry_id)
    OR (t.status = 'REVERSED') <> EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_id = t.journal_entry_id);

-- 5. Goals whose saved amount exceeds nothing sensible (negative progress).
SELECT 'violations.negative_goal_progress', count(*) FROM (
  SELECT goal_id, sum(CASE WHEN kind = 'CONTRIBUTION' THEN amount WHEN kind = 'WITHDRAWAL' THEN -amount ELSE 0 END) AS saved
    FROM goal_contributions WHERE status = 'POSTED' GROUP BY goal_id
) g WHERE g.saved < 0;

-- Fingerprints (compare source vs restore).
SELECT 'count.users', count(*) FROM users;
SELECT 'count.journal_entries', count(*) FROM journal_entries;
SELECT 'count.journal_lines', count(*) FROM journal_lines;
SELECT 'count.transactions', count(*) FROM transactions;
SELECT 'count.transfers', count(*) FROM transfers;
SELECT 'count.audit_logs', count(*) FROM audit_logs;
SELECT 'sum.debits_by_class.' || a.class, sum(l.debit)::text FROM journal_lines l
  JOIN ledger_accounts a ON a.id = l.ledger_account_id GROUP BY a.class ORDER BY a.class;
SELECT 'migrations.applied', count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
