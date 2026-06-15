import { Settings2 } from 'lucide-react';

/**
 * Placeholder shown where an integration (auth, payments) is scaffolded but not
 * yet credentialed. Keeps routes renderable during the skeleton phase.
 */
export function FeatureNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <Settings2 className="size-8 text-muted-foreground" />
      <h2 className="font-display text-xl font-semibold uppercase tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
