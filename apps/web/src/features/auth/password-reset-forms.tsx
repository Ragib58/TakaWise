'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { emailOnlyRequestSchema, resetPasswordRequestSchema } from '@takawise/contracts';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { forgotPassword, resetPassword } from '@/lib/auth/auth-api';

export function ForgotPasswordForm() {
  const router = useRouter();
  const form = useForm<
    z.input<typeof emailOnlyRequestSchema>,
    unknown,
    z.output<typeof emailOnlyRequestSchema>
  >({
    resolver: zodResolver(emailOnlyRequestSchema),
    defaultValues: { email: '' },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await forgotPassword(values);
      router.push(`/reset-password?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      handle(error);
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="text-sm text-muted-foreground">
        Enter your account email. If it is registered, we will send you a reset code.
      </p>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending…' : 'Send reset code'}
      </Button>
      <Link
        href="/login"
        className="text-center text-sm text-primary underline-offset-4 hover:underline"
      >
        Back to log in
      </Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const form = useForm<
    z.input<typeof resetPasswordRequestSchema>,
    unknown,
    z.output<typeof resetPasswordRequestSchema>
  >({
    resolver: zodResolver(resetPasswordRequestSchema),
    defaultValues: { email: params.get('email') ?? '', code: '', newPassword: '' },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await resetPassword(values);
      router.replace(`/login?reset=1&email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      const apiError = handle(error);
      if (apiError?.code === 'WEAK_PASSWORD')
        form.setError('newPassword', { message: apiError.message });
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <p className="text-sm text-muted-foreground">
        Enter the 6-digit code from your email. All devices will be signed out.
      </p>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <FormField
        label="Reset code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={errors.code?.message}
        {...form.register('code')}
      />
      <FormField
        label="New password"
        type="password"
        autoComplete="new-password"
        error={errors.newPassword?.message}
        {...form.register('newPassword')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}
