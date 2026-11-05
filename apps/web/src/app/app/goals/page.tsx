import type { Metadata } from 'next';
import { GoalsView } from '@/features/planning/goals-view';

export const metadata: Metadata = { title: 'Goals' };

export default function Page() {
  return <GoalsView />;
}
