import type { Metadata } from 'next';
import { AccountsView } from '@/features/finance/accounts-view';

export const metadata: Metadata = { title: 'Accounts' };

export default function Page() {
  return <AccountsView />;
}
