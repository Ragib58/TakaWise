import type { Metadata } from 'next';
import { ContentPage } from '../content';

export const metadata: Metadata = { title: 'Pricing' };

const PLANS = [
  {
    name: 'Free',
    status: 'Available now',
    points: [
      'Up to 10 active accounts; unlimited transactions',
      'Budgets, goals, reminders, reports and CSV export',
      'Investments, loans and net worth',
      'Opt-in AI insights and typed transaction drafts (where enabled)',
    ],
  },
  {
    name: 'Pro',
    status: 'Not on sale yet — price to be announced',
    points: ['Everything in Free', 'Unlimited accounts', 'Opt-in receipt scanning'],
  },
  {
    name: 'Family',
    status: 'Not on sale yet — price to be announced',
    points: [
      'Everything in Pro',
      'A family workspace for up to 6 people',
      'Each person chooses exactly what to share; nothing else is visible',
    ],
  },
];
export default function PricingPage() {
  return (
    <ContentPage
      title="Pricing"
      intro="TakaWise is free during the pilot. Paid plans are not on sale yet; nothing is charged today, and prices will be announced before anything is."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {PLANS.map((plan) => (
          <section key={plan.name} className="rounded-lg border bg-card p-4">
            <h2 className="!mt-0">{plan.name}</h2>
            <p className="text-sm text-muted-foreground">{plan.status}</p>
            <ul className="mt-2 text-sm">
              {plan.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </ContentPage>
  );
}
