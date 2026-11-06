import type { Metadata } from 'next';
import { SecuritySettings } from '@/features/finance/settings-views';

export const metadata: Metadata = { title: 'Security' };

export default function Page() {
  return <SecuritySettings />;
}
