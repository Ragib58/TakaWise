import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Dashboard' };

/** Placeholder. The real dashboard (balances, cash flow, budgets, goals) is Phase 6. */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
      <div className="rounded-lg border border-dashed bg-card p-8 text-center text-muted-foreground">
        Your financial overview will appear here.
      </div>
    </div>
  );
}
