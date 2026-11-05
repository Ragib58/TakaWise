import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Status message with an icon + text (never colour alone, blueprint §9.4). */
export function Alert({
  variant = 'error',
  children,
  className,
}: {
  variant?: 'error' | 'success';
  children: ReactNode;
  className?: string;
}) {
  const Icon = variant === 'error' ? CircleAlert : CircleCheck;
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        variant === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-positive/30 bg-positive/5 text-positive',
        className,
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}
