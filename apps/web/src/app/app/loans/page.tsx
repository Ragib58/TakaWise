import type { Metadata } from 'next';
import { LoansView } from '@/features/wealth/loans-view';

export const metadata: Metadata = { title: 'Loans' };

export default function Page() {
  return <LoansView />;
}
