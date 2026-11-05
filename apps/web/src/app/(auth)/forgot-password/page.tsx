import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ForgotPasswordForm } from '@/features/auth/password-reset-forms';

export const metadata: Metadata = { title: 'Forgot password' };

export default function Page() {
  // Suspense: the form reads search params on the client.
  return (
    <Suspense>
      <ForgotPasswordForm />
    </Suspense>
  );
}
