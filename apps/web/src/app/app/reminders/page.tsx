import type { Metadata } from 'next';
import { RemindersView } from '@/features/planning/reminders-view';

export const metadata: Metadata = { title: 'Reminders' };

export default function Page() {
  return <RemindersView />;
}
