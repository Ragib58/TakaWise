import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Create account' };

export default function Page() {
  // Suspense: the form reads search params on the client.
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
