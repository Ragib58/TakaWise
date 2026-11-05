import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Native select: accessible and mobile-friendly by default. */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-background px-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 md:text-sm',
        className,
      )}
      {...props}
    />
  );
}
