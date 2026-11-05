'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { loginRequestSchema } from '@takawise/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { login, safeNextPath } from '@/lib/auth/auth-api';

type Values = z.input<typeof loginRequestSchema>;

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const form = useForm<Values, unknown, z.output<typeof loginRequestSchema>>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: params.get('email') ?? '', password: '' },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await login(values);
      router.replace(safeNextPath(params.get('next')));
    } catch (error) {
      const apiError = handle(error);
      if (apiError?.code === 'EMAIL_NOT_VERIFIED') {
        router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
      }
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      {params.get('reset') === '1' ? (
        <Alert variant="success">Password updated. Log in with your new password.</Alert>
      ) : null}
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <FormField
        label="Password"
        type="password"
        autoComplete="current-password"
        error={errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Logging in…' : 'Log in'}
      </Button>
      <div className="flex justify-between text-sm">
        <Link href="/forgot-password" className="text-primary underline-offset-4 hover:underline">
          Forgot password?
        </Link>
        <Link href="/register" className="text-primary underline-offset-4 hover:underline">
          Create account
        </Link>
      </div>
    </form>
  );
}
