import type { Metadata } from 'next';
import { ContentPage } from '../content';

export const metadata: Metadata = { title: 'Help' };

export default function HelpPage() {
  return (
    <ContentPage title="Help" intro="Quick answers to common questions.">
      <h2>How do I start?</h2>
      <p>
        Add your accounts (cash, bank, bKash/Nagad, card) with their current balance, then record
        income and expenses as they happen.
      </p>
      <h2>I entered a transaction by mistake.</h2>
      <p>
        Open Transactions and choose Reverse. The entry stays in your history and a correcting entry
        restores your balance.
      </p>
      <h2>Why is paying my credit card not an expense?</h2>
      <p>
        The spending was already recorded when you used the card. Paying the bill moves money from
        your bank to the card, so it is a transfer.
      </p>
      <h2>Does a savings goal move my money?</h2>
      <p>No. A goal sets aside part of an account balance. Your money stays in that account.</p>
      <h2>Can I get my data out?</h2>
      <p>Yes. Reports → Export CSV downloads your transactions and transfers.</p>
    </ContentPage>
  );
}
