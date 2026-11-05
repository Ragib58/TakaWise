import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = { title: 'Log in' };

export default function Page() {
  // Suspense: the form reads search params on the client.
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
