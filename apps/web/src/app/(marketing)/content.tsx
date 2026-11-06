import type { ReactNode } from 'react';

/** Simple prose wrapper for public content pages. */
export function ContentPage({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-primary">{title}</h1>
        {intro ? <p className="text-lg text-muted-foreground">{intro}</p> : null}
      </header>
      <div className="flex flex-col gap-4 leading-relaxed [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc">
        {children}
      </div>
    </article>
  );
}

export function DraftNotice() {
  return (
    <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
      Draft for the pilot. This text will be reviewed by qualified counsel in Bangladesh before
      public launch.
    </p>
  );
}
