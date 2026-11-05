import type { Metadata } from 'next';
import { NotificationsView } from '@/features/planning/reminders-view';

export const metadata: Metadata = { title: 'Notifications' };

export default function Page() {
  return <NotificationsView />;
}
