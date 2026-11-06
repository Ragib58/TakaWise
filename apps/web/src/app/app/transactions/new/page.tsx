import type { Metadata } from 'next';
import { NewTransactionForm } from '@/features/finance/new-transaction-form';

export const metadata: Metadata = { title: 'New transaction' };

export default function Page() {
  return <NewTransactionForm />;
}
