import type { Metadata } from 'next';
import { BudgetsView } from '@/features/planning/budgets-view';

export const metadata: Metadata = { title: 'Budgets' };

export default function Page() {
  return <BudgetsView />;
}
