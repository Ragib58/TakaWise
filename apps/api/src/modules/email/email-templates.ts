import type { Locale } from '@takawise/contracts';
import type { EmailMessage } from './email.types';

/**
 * Plain-text, bilingual transactional emails. Codes are the only secret in an
 * email; links never carry tokens. Copy is reviewed before launch (blueprint §18).
 */

type Template = (args: { to: string; name: string; code?: string; appUrl: string }) => EmailMessage;

const SIGNATURE = {
  en: '— TakaWise\nWe will never ask for your bank or mobile-wallet PIN, password or OTP.',
  bn: '— TakaWise\nআমরা কখনো আপনার ব্যাংক বা মোবাইল ওয়ালেটের পিন, পাসওয়ার্ড বা ওটিপি চাইব না।',
};

const templates: Record<
  'verifyEmail' | 'passwordReset' | 'accountExists',
  Record<Locale, Template>
> = {
  verifyEmail: {
    en: ({ to, name, code }) => ({
      to,
      subject: `Your TakaWise verification code: ${code}`,
      text: `Hi ${name},\n\nYour verification code is ${code}. It expires in 10 minutes.\n\nIf you did not create a TakaWise account, ignore this email.\n\n${SIGNATURE.en}`,
    }),
    bn: ({ to, name, code }) => ({
      to,
      subject: `আপনার TakaWise যাচাইকরণ কোড: ${code}`,
      text: `প্রিয় ${name},\n\nআপনার যাচাইকরণ কোড ${code}। কোডটি ১০ মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে।\n\nআপনি TakaWise অ্যাকাউন্ট না খুলে থাকলে এই ইমেইলটি উপেক্ষা করুন।\n\n${SIGNATURE.bn}`,
    }),
  },
  passwordReset: {
    en: ({ to, name, code }) => ({
      to,
      subject: `Your TakaWise password reset code: ${code}`,
      text: `Hi ${name},\n\nUse ${code} to reset your password. It expires in 15 minutes.\n\nIf you did not ask for this, you can ignore this email — your password stays the same.\n\n${SIGNATURE.en}`,
    }),
    bn: ({ to, name, code }) => ({
      to,
      subject: `আপনার TakaWise পাসওয়ার্ড রিসেট কোড: ${code}`,
      text: `প্রিয় ${name},\n\nপাসওয়ার্ড রিসেট করতে ${code} কোডটি ব্যবহার করুন। কোডটি ১৫ মিনিটের মধ্যে মেয়াদোত্তীর্ণ হবে।\n\nআপনি অনুরোধ না করে থাকলে ইমেইলটি উপেক্ষা করুন — আপনার পাসওয়ার্ড অপরিবর্তিত থাকবে।\n\n${SIGNATURE.bn}`,
    }),
  },
  accountExists: {
    en: ({ to, name, appUrl }) => ({
      to,
      subject: 'Someone tried to sign up with your email',
      text: `Hi ${name},\n\nSomeone tried to create a TakaWise account with this email, but you already have one. You can log in at ${appUrl}/login, or reset your password there if you forgot it.\n\n${SIGNATURE.en}`,
    }),
    bn: ({ to, name, appUrl }) => ({
      to,
      subject: 'আপনার ইমেইল দিয়ে নতুন অ্যাকাউন্ট খোলার চেষ্টা হয়েছে',
      text: `প্রিয় ${name},\n\nএই ইমেইল দিয়ে কেউ নতুন TakaWise অ্যাকাউন্ট খোলার চেষ্টা করেছে, কিন্তু আপনার অ্যাকাউন্ট আগে থেকেই আছে। ${appUrl}/login এ লগইন করুন, বা পাসওয়ার্ড ভুলে গেলে সেখান থেকে রিসেট করুন।\n\n${SIGNATURE.bn}`,
    }),
  },
};

export function renderEmail(
  name: keyof typeof templates,
  locale: Locale,
  args: Parameters<Template>[0],
): EmailMessage {
  return templates[name][locale](args);
}
