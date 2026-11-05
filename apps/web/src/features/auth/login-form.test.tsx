import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import type * as AuthApi from '@/lib/auth/auth-api';
import { LoginForm } from './login-form';

const replace = vi.fn();
const push = vi.fn();
let search = new URLSearchParams();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => search,
}));

const loginMock = vi.fn();
vi.mock('@/lib/auth/auth-api', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthApi>()),
  login: (...args: unknown[]) => loginMock(...args) as unknown,
}));

describe('LoginForm', () => {
  beforeEach(() => {
    replace.mockReset();
    push.mockReset();
    loginMock.mockReset();
    search = new URLSearchParams();
  });

  it('shows field errors without calling the API', async () => {
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    expect(loginMock).not.toHaveBeenCalled();
  });

  it('logs in and goes to a safe next path only', async () => {
    search = new URLSearchParams({ next: '//evil.example' });
    loginMock.mockResolvedValue({});
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'A@Example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret pass' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/app/dashboard'));
    expect(loginMock).toHaveBeenCalledWith({ email: 'a@example.com', password: 'secret pass' });
  });

  it('shows the API error and sends unverified users to verification', async () => {
    loginMock.mockRejectedValue(
      new ApiError(403, 'EMAIL_NOT_VERIFIED', 'Please verify your email address first.'),
    );
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please verify your email address first.',
    );
    expect(push).toHaveBeenCalledWith('/verify-email?email=a%40example.com');
  });
});
