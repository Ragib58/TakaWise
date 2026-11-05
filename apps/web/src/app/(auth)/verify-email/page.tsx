import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailForm } from '@/features/auth/verify-email-form';

export const metadata: Metadata = { title: 'Verify email' };

export default function Page() {
  // Suspense: the form reads search params on the client.
  return (
    <Suspense>
      <VerifyEmailForm />
    </Suspense>
  );
}
