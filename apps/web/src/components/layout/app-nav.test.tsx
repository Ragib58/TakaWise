import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { APP_NAV } from '@/config/navigation';
import { BottomNav, SidebarNav } from './app-nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/transactions/new',
}));

describe('SidebarNav', () => {
  it('renders every app section and marks the active one', () => {
    render(<SidebarNav />);
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const links = within(nav).getAllByRole('link');

    expect(links).toHaveLength(APP_NAV.length);
    expect(within(nav).getByRole('link', { name: 'Transactions' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

describe('BottomNav', () => {
  it('shows at most five mobile destinations', () => {
    render(<BottomNav />);
    const links = within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link');
    expect(links.length).toBeLessThanOrEqual(5);
    expect(links.map((l) => l.getAttribute('href'))).toContain('/app/dashboard');
  });
});
