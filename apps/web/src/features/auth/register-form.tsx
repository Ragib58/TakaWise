'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { registerRequestSchema } from '@takawise/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormField } from '@/components/forms/form-field';
import { useApiFormError } from '@/components/forms/use-api-form-error';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { register as registerAccount } from '@/lib/auth/auth-api';

type Values = z.input<typeof registerRequestSchema>;

export function RegisterForm() {
  const router = useRouter();
  const form = useForm<Values, unknown, z.output<typeof registerRequestSchema>>({
    resolver: zodResolver(registerRequestSchema),
    defaultValues: { fullName: '', email: '', password: '', locale: 'en' },
  });
  const { formError, handle } = useApiFormError(form.setError);
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await registerAccount(values);
      router.push(`/verify-email?email=${encodeURIComponent(values.email)}`);
    } catch (error) {
      const apiError = handle(error);
      if (apiError?.code === 'WEAK_PASSWORD') {
        form.setError('password', { message: apiError.message });
      }
    }
  });

  return (
    <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Create your account</h1>
      {formError ? <Alert>{formError}</Alert> : null}
      <FormField
        label="Full name"
        autoComplete="name"
        error={errors.fullName?.message}
        {...form.register('fullName')}
      />
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
        autoComplete="new-password"
        hint="At least 8 characters. A short sentence is easy to remember and hard to guess."
        error={errors.password?.message}
        {...form.register('password')}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Language / ভাষা</legend>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" value="en" {...form.register('locale')} /> English
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" value="bn" {...form.register('locale')} /> বাংলা
          </label>
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            aria-invalid={errors.acceptTerms ? true : undefined}
            {...form.register('acceptTerms')}
          />
          <span>
            I agree to the{' '}
            <Link href="/terms" className="text-primary underline">
              Terms
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="text-primary underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        {errors.acceptTerms ? (
          <p className="text-xs text-destructive">{errors.acceptTerms.message}</p>
        ) : null}
      </div>
      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Creating account…' : 'Create account'}
      </Button>
      <p className="text-center text-sm">
        Already have an account?{' '}
        <Link href="/login" className="text-primary underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
