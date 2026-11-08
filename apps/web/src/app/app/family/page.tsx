import type { Metadata } from 'next';
import { FamilyView } from '@/features/saas/family-view';

export const metadata: Metadata = { title: 'Family' };

export default function Page() {
  return <FamilyView />;
}
