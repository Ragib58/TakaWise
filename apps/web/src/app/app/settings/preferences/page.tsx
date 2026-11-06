import type { Metadata } from 'next';
import { PreferencesSettings } from '@/features/finance/settings-views';

export const metadata: Metadata = { title: 'Preferences' };

export default function Page() {
  return <PreferencesSettings />;
}
