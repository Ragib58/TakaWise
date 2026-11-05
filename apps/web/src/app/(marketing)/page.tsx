import Link from 'next/link';
import { Button } from '@/components/ui/button';

/** Placeholder landing page. Full marketing content arrives in Phase 6. */
export default function HomePage() {
  return (
    <section className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-24 text-center">
      <p className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
        Bangladesh-first · বাংলা ও English
      </p>
      <h1 className="text-4xl font-bold tracking-tight text-primary sm:text-5xl">
        A clear picture of your money
      </h1>
      <p className="max-w-xl text-lg text-muted-foreground">
        Record income and expenses across cash, bank and mobile-wallet accounts, set budgets and
        savings goals, and understand your cash flow.
      </p>
      <p lang="bn" className="text-muted-foreground">
        আপনার আয়-ব্যয়, বাজেট ও সঞ্চয়ের লক্ষ্য — এক জায়গায়।
      </p>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link href="/register">Create free account</Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href="/app/dashboard">Open app</Link>
        </Button>
      </div>
    </section>
  );
}
