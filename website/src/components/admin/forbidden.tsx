import Link from 'next/link';

/**
 * Rendered when a signed-in user opens a section their role cannot use. The
 * matching repo calls refuse them as well — this is only the friendly face of
 * the same rule.
 */
export function ForbiddenNotice({ what = 'dit onderdeel' }: { what?: string }) {
  return (
    <div className="border border-l-4 border-border border-l-destructive bg-card p-6">
      <h1 className="text-3xl leading-none">Geen toegang</h1>
      <p className="mt-3 text-base text-muted-foreground">
        Je rol geeft geen toegang tot {what}. Vraag een beheerder als je dit nodig hebt.
      </p>
      <p className="mt-4 text-sm">
        <Link href="/admin" className="underline underline-offset-4 hover:text-primary">
          Terug naar het overzicht
        </Link>
      </p>
    </div>
  );
}
