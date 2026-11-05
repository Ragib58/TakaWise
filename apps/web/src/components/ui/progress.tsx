import { CircleAlert, CircleCheck, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type Status = 'ok' | 'warning' | 'over';

const STATUS_TEXT: Record<Status, string> = {
  ok: 'On track',
  warning: 'Near limit',
  over: 'Over limit',
};
const STATUS_ICON = { ok: CircleCheck, warning: TriangleAlert, over: CircleAlert };

/**
 * Accessible progress bar. Meaning is carried by text and an icon as well as
 * colour (blueprint §9.4). `percent` is the API's decimal string, e.g. "82.50".
 */
export function ProgressBar({
  percent,
  label,
  status = 'ok',
  showStatus = true,
}: {
  percent: string;
  label: string;
  status?: Status;
  showStatus?: boolean;
}) {
  const value = Math.min(100, Math.max(0, Number.parseFloat(percent)));
  const Icon = STATUS_ICON[status];
  return (
    <div className="flex flex-col gap-1">
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-valuetext={`${percent}% — ${STATUS_TEXT[status]}`}
        className="h-2 w-full overflow-hidden rounded-full bg-secondary"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            status === 'over'
              ? 'bg-destructive'
              : status === 'warning'
                ? 'bg-amber-500'
                : 'bg-brand-teal',
          )}
          style={{ width: `${value}%` }}
        />
      </div>
      {showStatus ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
          {percent}% · {STATUS_TEXT[status]}
        </span>
      ) : null}
    </div>
  );
}
