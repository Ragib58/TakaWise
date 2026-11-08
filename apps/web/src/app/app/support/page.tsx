import type { Metadata } from 'next';
import { SupportView } from '@/features/saas/support-view';

export const metadata: Metadata = { title: 'Support' };

export default function Page() {
  return <SupportView />;
}
