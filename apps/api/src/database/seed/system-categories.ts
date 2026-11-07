import type { CategoryType } from '../../generated/prisma/enums';

export type SystemCategorySeed = {
  /** Stable identifier; never change once released (seed upserts by it). */
  key: string;
  type: CategoryType;
  nameEn: string;
  nameBn: string;
  icon: string;
  children?: Omit<SystemCategorySeed, 'type' | 'children'>[];
};

/**
 * Bilingual system categories (CAT-01), tuned for everyday life in Bangladesh.
 * Users can add their own; system categories are shared and read-only.
 */
export const SYSTEM_CATEGORIES: readonly SystemCategorySeed[] = [
  // ───────────── Expense ─────────────
  {
    key: 'expense.food',
    type: 'EXPENSE',
    nameEn: 'Food & Dining',
    nameBn: 'খাবার ও রেস্তোরাঁ',
    icon: 'utensils',
  },
  {
    key: 'expense.groceries',
    type: 'EXPENSE',
    nameEn: 'Groceries',
    nameBn: 'বাজার-সদাই',
    icon: 'shopping-basket',
  },
  {
    key: 'expense.transport',
    type: 'EXPENSE',
    nameEn: 'Transport',
    nameBn: 'যাতায়াত',
    icon: 'bus',
  },
  {
    key: 'expense.rent',
    type: 'EXPENSE',
    nameEn: 'House Rent',
    nameBn: 'বাসা ভাড়া',
    icon: 'home',
  },
  {
    key: 'expense.utilities',
    type: 'EXPENSE',
    nameEn: 'Utilities',
    nameBn: 'ইউটিলিটি বিল',
    icon: 'plug',
    children: [
      {
        key: 'expense.utilities.electricity',
        nameEn: 'Electricity',
        nameBn: 'বিদ্যুৎ বিল',
        icon: 'zap',
      },
      { key: 'expense.utilities.gas', nameEn: 'Gas', nameBn: 'গ্যাস বিল', icon: 'flame' },
      { key: 'expense.utilities.water', nameEn: 'Water', nameBn: 'পানির বিল', icon: 'droplet' },
    ],
  },
  {
    key: 'expense.mobile_internet',
    type: 'EXPENSE',
    nameEn: 'Mobile & Internet',
    nameBn: 'মোবাইল ও ইন্টারনেট',
    icon: 'smartphone',
  },
  {
    key: 'expense.health',
    type: 'EXPENSE',
    nameEn: 'Health & Medicine',
    nameBn: 'স্বাস্থ্য ও ওষুধ',
    icon: 'heart-pulse',
  },
  {
    key: 'expense.education',
    type: 'EXPENSE',
    nameEn: 'Education',
    nameBn: 'শিক্ষা',
    icon: 'graduation-cap',
  },
  {
    key: 'expense.shopping',
    type: 'EXPENSE',
    nameEn: 'Shopping',
    nameBn: 'কেনাকাটা',
    icon: 'shopping-bag',
  },
  { key: 'expense.clothing', type: 'EXPENSE', nameEn: 'Clothing', nameBn: 'পোশাক', icon: 'shirt' },
  {
    key: 'expense.household',
    type: 'EXPENSE',
    nameEn: 'Household',
    nameBn: 'গৃহস্থালি',
    icon: 'sofa',
  },
  {
    key: 'expense.personal_care',
    type: 'EXPENSE',
    nameEn: 'Personal Care',
    nameBn: 'ব্যক্তিগত যত্ন',
    icon: 'sparkles',
  },
  {
    key: 'expense.family_support',
    type: 'EXPENSE',
    nameEn: 'Family Support',
    nameBn: 'পরিবারকে সহায়তা',
    icon: 'users',
  },
  {
    key: 'expense.entertainment',
    type: 'EXPENSE',
    nameEn: 'Entertainment',
    nameBn: 'বিনোদন',
    icon: 'clapperboard',
  },
  { key: 'expense.travel', type: 'EXPENSE', nameEn: 'Travel', nameBn: 'ভ্রমণ', icon: 'plane' },
  {
    key: 'expense.charity',
    type: 'EXPENSE',
    nameEn: 'Charity & Zakat',
    nameBn: 'দান ও যাকাত',
    icon: 'hand-heart',
  },
  { key: 'expense.gifts', type: 'EXPENSE', nameEn: 'Gifts', nameBn: 'উপহার', icon: 'gift' },
  {
    key: 'expense.fees',
    type: 'EXPENSE',
    nameEn: 'Bank & MFS Charges',
    nameBn: 'ব্যাংক ও এমএফএস চার্জ',
    icon: 'receipt',
  },
  {
    key: 'expense.insurance',
    type: 'EXPENSE',
    nameEn: 'Insurance',
    nameBn: 'বীমা',
    icon: 'shield',
  },
  {
    // Phase 8: interest part of a loan repayment (the principal is a transfer).
    key: 'expense.loan_interest',
    type: 'EXPENSE',
    nameEn: 'Loan Interest',
    nameBn: 'ঋণের সুদ',
    icon: 'percent',
  },
  { key: 'expense.taxes', type: 'EXPENSE', nameEn: 'Taxes', nameBn: 'কর', icon: 'landmark' },
  {
    key: 'expense.other',
    type: 'EXPENSE',
    nameEn: 'Other Expense',
    nameBn: 'অন্যান্য খরচ',
    icon: 'circle-ellipsis',
  },

  // ───────────── Income ─────────────
  { key: 'income.salary', type: 'INCOME', nameEn: 'Salary', nameBn: 'বেতন', icon: 'briefcase' },
  { key: 'income.bonus', type: 'INCOME', nameEn: 'Bonus', nameBn: 'বোনাস', icon: 'badge-plus' },
  {
    key: 'income.business',
    type: 'INCOME',
    nameEn: 'Business Income',
    nameBn: 'ব্যবসায়িক আয়',
    icon: 'store',
  },
  {
    key: 'income.freelance',
    type: 'INCOME',
    nameEn: 'Freelance',
    nameBn: 'ফ্রিল্যান্সিং',
    icon: 'laptop',
  },
  {
    key: 'income.remittance',
    type: 'INCOME',
    nameEn: 'Remittance',
    nameBn: 'রেমিট্যান্স',
    icon: 'globe',
  },
  {
    key: 'income.rental',
    type: 'INCOME',
    nameEn: 'Rental Income',
    nameBn: 'ভাড়া থেকে আয়',
    icon: 'building',
  },
  {
    key: 'income.profit_interest',
    type: 'INCOME',
    nameEn: 'Profit & Interest',
    nameBn: 'মুনাফা ও সুদ',
    icon: 'trending-up',
  },
  {
    key: 'income.gifts',
    type: 'INCOME',
    nameEn: 'Gifts Received',
    nameBn: 'প্রাপ্ত উপহার',
    icon: 'gift',
  },
  { key: 'income.refunds', type: 'INCOME', nameEn: 'Refunds', nameBn: 'ফেরত', icon: 'undo-2' },
  {
    key: 'income.other',
    type: 'INCOME',
    nameEn: 'Other Income',
    nameBn: 'অন্যান্য আয়',
    icon: 'circle-ellipsis',
  },
];
