import type { Metadata } from 'next';
import { ContentPage, DraftNotice } from '../content';

export const metadata: Metadata = { title: 'Privacy Policy' };

export default function PrivacyPage() {
  return (
    <ContentPage title="Privacy Policy">
      <DraftNotice />
      <h2>What we collect</h2>
      <ul>
        <li>
          Account details: your name, email address and preferences (language, time zone, currency).
        </li>
        <li>
          Financial records you choose to enter: accounts, transactions, budgets, goals and
          reminders.
        </li>
        <li>
          Security data: a hashed password, session records, and pseudonymised (hashed) IP addresses
          in audit logs.
        </li>
      </ul>
      <h2>What we never collect</h2>
      <p>Bank or mobile-wallet passwords, PINs, card CVVs or one-time passwords.</p>
      <h2>How we use it</h2>
      <p>
        Only to provide the service: calculating balances and reports, sending verification codes
        and reminders, and keeping your account secure. We do not sell your data.
      </p>
      <h2>Your choices</h2>
      <p>
        You can export your data at any time and request correction or deletion of your account.
      </p>
    </ContentPage>
  );
}
