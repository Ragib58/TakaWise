import Link from 'next/link';
import type { ReactNode } from 'react';

export default function AuthLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-secondary/40 px-4 py-10">
      <Link href="/" className="mb-6 text-2xl font-bold tracking-tight text-primary">
        TakaWise
      </Link>
      <main className="w-full max-w-sm rounded-xl border bg-card p-6 shadow-sm">{children}</main>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        TakaWise will never ask for your bank or mobile-wallet PIN, password or OTP.
      </p>
    </div>
  );
}
