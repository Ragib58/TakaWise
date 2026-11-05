'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { verifyEmailRequestSchema } from '@takawise/contracts';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { resendVerification, verifyEmail } from '@/lib/auth/auth-api';

type Values = z.input<typeof verifyEmailRequestSchema>;

/** Matches the server's resend cooldown. */
const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailForm() {
  const router = useRouter();
  const params = useSearchParams();
  const form = useForm<Values, unknown, z.output<typeof verifyEmailRequestSchema>>({
    resolver: zodResolver(verifyEmailRequestSchema),
    defaultValues: { email: params.get('email') ?? '', code: '' },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const { errors, isSubmitting } = form.formState;
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await verifyEmail(values);
      router.replace('/app/dashboard');
    } catch (error) {
      handle(error);
    }
  });

  async function onResend() {
    const email = form.getValues('email');
    if (!email) {
      form.setError('email', { message: 'Enter your email address' });
      return;
    }
    try {
      await resendVerification({ email });
      setNotice('If your account is waiting for verification, a new code is on its way.');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (error) {
      handle(error);
    }
  }

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Verify your email</h1>
      <p className="text-sm text-muted-foreground">
        We sent a 6-digit code to your email. It expires in 10 minutes.
      </p>
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        label="Email"
        type="email"
        autoComplete="email"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <FormField
        label="Verification code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        error={errors.code?.message}
        {...form.register('code')}
      />
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Verifying…' : 'Verify and continue'}
      </Button>
      <Button type="button" variant="ghost" disabled={cooldown > 0} onClick={() => void onResend()}>
        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
      </Button>
    </form>
  );
}
