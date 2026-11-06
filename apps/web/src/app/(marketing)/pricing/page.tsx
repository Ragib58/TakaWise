import type { Metadata } from 'next';
import { ContentPage } from '../content';

export const metadata: Metadata = { title: 'Pricing' };

const PLANS = [
  {
    name: 'Free',
    status: 'Available now (pilot)',
    points: [
      'Unlimited accounts and transactions',
      'Budgets, goals and reminders',
      'Reports and CSV export',
    ],
  },
  {
    name: 'Pro',
    status: 'Planned — not available yet',
    points: [
      'Recurring transactions and CSV import',
      'Receipt scanning',
      'Investments, loans and net worth',
    ],
  },
  {
    name: 'Family',
    status: 'Planned — not available yet',
    points: ['Shared family workspace', 'Roles and explicitly shared budgets'],
  },
];

export default function PricingPage() {
  return (
    <ContentPage
      title="Pricing"
      intro="TakaWise is free during the pilot. Paid plans are planned; nothing is charged today."
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
