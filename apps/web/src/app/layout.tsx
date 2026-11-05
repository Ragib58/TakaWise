import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Bengali } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const bengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-bengali',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'TakaWise — Smart personal finance',
    template: '%s · TakaWise',
  },
  description:
    'Track income and expenses, manage cash, bank and mobile-wallet accounts, and plan budgets and savings goals.',
  applicationName: process.env.NEXT_PUBLIC_APP_NAME ?? 'TakaWise',
};

export const viewport: Viewport = {
  themeColor: '#1b2a4a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${bengali.variable}`}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
