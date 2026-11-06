import type { Metadata } from 'next';
import { ContentPage } from '../content';

export const metadata: Metadata = { title: 'About' };

export default function AboutPage() {
  return (
    <ContentPage
      title="About TakaWise"
      intro="Turning scattered financial records into a clear, trustworthy picture."
    >
      <p>
        TakaWise is a Bangladesh-first personal finance app for recording income and expenses,
        managing accounts, and planning with budgets and savings goals.
      </p>
      <p>
        TakaWise is not a bank, wallet, lender, brokerage or licensed financial adviser, and it does
        not provide investment, tax or legal advice.
      </p>
      <h2>Contact</h2>
      <p>
        Pilot feedback and support: please use the contact address shared with your pilot
        invitation.
      </p>
    </ContentPage>
  );
}
