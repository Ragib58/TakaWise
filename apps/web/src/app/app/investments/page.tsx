import type { Metadata } from 'next';
import { InvestmentsView } from '@/features/wealth/investments-view';

export const metadata: Metadata = { title: 'Investments' };

export default function Page() {
  return <InvestmentsView />;
}
