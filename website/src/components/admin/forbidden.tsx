import Link from 'next/link';

/**
 * Rendered when a signed-in user opens a section their role cannot use. The
 * matching repo calls refuse them as well — this is only the friendly face of
 * the same rule.
 */
export function ForbiddenNotice({ what = 'dit onderdeel' }: { what?: string }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
      <h1 className="font-heading text-lg font-semibold">Geen toegang</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Je rol geeft geen toegang tot {what}. Vraag een beheerder als je dit nodig hebt.
      </p>
      <p className="mt-3 text-xs">
        <Link href="/admin" className="underline underline-offset-4">
          Terug naar het overzicht
        </Link>
      </p>
    </div>
  );
}
