import type { Metadata } from 'next';
import { NetWorthView } from '@/features/wealth/net-worth-view';

export const metadata: Metadata = { title: 'Net worth' };

export default function Page() {
  return <NetWorthView />;
}
