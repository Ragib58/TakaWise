import type { Metadata } from 'next';
import { ProfileSettings } from '@/features/finance/settings-views';

export const metadata: Metadata = { title: 'Profile' };

export default function Page() {
  return <ProfileSettings />;
}
