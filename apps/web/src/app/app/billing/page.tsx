import type { Metadata } from 'next';
import { Suspense } from 'react';
import { BillingView } from '@/features/saas/billing-view';

export const metadata: Metadata = { title: 'Plan & billing' };

export default function Page() {
  return (
    <Suspense>
      <BillingView />
    </Suspense>
  );
}
