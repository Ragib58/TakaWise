import type { Metadata } from 'next';
import { ContentPage, DraftNotice } from '../content';

export const metadata: Metadata = { title: 'Terms of Use' };

export default function TermsPage() {
  return (
    <ContentPage title="Terms of Use">
      <DraftNotice />
      <h2>The service</h2>
      <p>
        TakaWise is a recordkeeping and planning tool. It does not hold, move or invest money and is
        not a bank, wallet, lender or financial adviser.
      </p>
      <h2>Your responsibilities</h2>
      <ul>
        <li>Keep your login details secure and do not share your account.</li>
        <li>
          Figures in TakaWise are based on what you enter; verify important decisions with official
          statements.
        </li>
      </ul>
      <h2>No financial advice</h2>
      <p>Nothing in TakaWise is investment, tax or legal advice.</p>
      <h2>Pilot</h2>
      <p>During the pilot, features may change and the service is provided free of charge.</p>
    </ContentPage>
  );
}
