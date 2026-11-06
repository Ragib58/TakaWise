import type { Metadata } from 'next';
import { TransactionsView } from '@/features/finance/transactions-view';

export const metadata: Metadata = { title: 'Transactions' };

export default function Page() {
  return <TransactionsView />;
}
