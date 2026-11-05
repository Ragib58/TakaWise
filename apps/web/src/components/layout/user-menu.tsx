'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useSession } from '@/components/auth/auth-provider';
import { Button } from '@/components/ui/button';
import { logout } from '@/lib/auth/auth-api';

export function UserMenu() {
  const session = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  if (session.status !== 'authenticated') return null;

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
    } finally {
      router.replace('/login');
    }
  }

  return (
    <div className="ml-auto flex items-center gap-3">
      <span className="hidden text-sm text-muted-foreground sm:inline">
        {session.user.profile.fullName}
      </span>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void onLogout()}>
        <LogOut aria-hidden />
        Log out
      </Button>
    </div>
  );
}
