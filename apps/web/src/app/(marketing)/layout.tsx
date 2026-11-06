import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export default function MarketingLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="text-lg font-bold tracking-tight text-primary">
            TakaWise
          </Link>
          <nav aria-label="Site" className="hidden items-center gap-4 text-sm sm:flex">
            <Link href="/features" className="text-muted-foreground hover:text-foreground">
              Features
            </Link>
            <Link href="/pricing" className="text-muted-foreground hover:text-foreground">
              Pricing
            </Link>
            <Link href="/help" className="text-muted-foreground hover:text-foreground">
              Help
            </Link>
          </nav>
          <nav aria-label="Account" className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">Log in</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/register">Get started</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="flex flex-col gap-2 border-t py-6 text-center text-sm text-muted-foreground">
        <nav aria-label="Footer" className="flex justify-center gap-4">
          <Link href="/about">About</Link>
          <Link href="/help">Help</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
        </nav>
        <p>
          © {new Date().getFullYear()} TakaWise · A personal recordkeeping and planning tool — not a
          bank, wallet or financial adviser.
        </p>
      </footer>
    </div>
  );
}
