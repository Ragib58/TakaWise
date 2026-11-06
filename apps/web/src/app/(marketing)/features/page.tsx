import type { Metadata } from 'next';
import { ContentPage } from '../content';

export const metadata: Metadata = { title: 'Features' };

export default function FeaturesPage() {
  return (
    <ContentPage
      title="Features"
      intro="Everything you need to keep an honest record of your money — in Bangla or English."
    >
      <h2>Accounts</h2>
      <p>
        Track cash, bank, savings, mobile wallets (bKash, Nagad, Rocket) and credit cards. Balances
        are calculated from your own entries using double-entry bookkeeping, so they always add up.
      </p>
      <h2>Income, expenses and transfers</h2>
      <p>
        Record what you earn and spend in seconds. Moving money between your own accounts — or
        paying a card bill — is a transfer, never counted as spending.
      </p>
      <h2>Budgets and savings goals</h2>
      <p>
        Set monthly limits per category and see progress as you spend. Set money aside for goals
        like Eid shopping or an emergency fund without moving it out of your account.
      </p>
      <h2>Reports and export</h2>
      <p>
        Monthly income vs spending, category breakdowns and account summaries. Export your data to
        CSV at any time.
      </p>
      <h2>Security</h2>
      <ul>
        <li>We never ask for your bank or mobile-wallet password, PIN, card CVV or OTP.</li>
        <li>
          TakaWise does not connect to your bank or move money — it is a recordkeeping and planning
          tool.
        </li>
        <li>
          Passwords are protected with Argon2id; sessions can be reviewed and signed out at any
          time.
        </li>
      </ul>
    </ContentPage>
  );
}
