import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { PageHeading } from '@/components/admin/shell';
import { badgeTone } from '@/components/admin/tones';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listPages, publicPathFor } from '@/lib/cms/repo';
import { listPageLocales } from '@/lib/cms/repo-admin';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Pagina’s' };

/** Filter tabs in the studio's condensed caps; the active one is the burgundy accent. */
const FILTER_BASE = 'admin-label border px-2.5 py-1 transition-colors';
const FILTER_ACTIVE = `${FILTER_BASE} border-primary bg-primary text-primary-foreground`;
const FILTER_IDLE = `${FILTER_BASE} border-ds-bone-400 hover:border-primary hover:text-primary`;

type Search = { locale?: string; status?: string };

export default async function AdminPagesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await requireCmsUser();
  if (!can(user.role, 'page.read')) return <ForbiddenNotice what="de pagina’s" />;

  const { locale: localeParam, status } = await searchParams;
  const locales = await listPageLocales();
  const locale = localeParam || DEFAULT_LOCALE;

  const all = await listPages(locale);
  const pages =
    status === 'published' || status === 'draft'
      ? all.filter((page) => page.status === status)
      : all;

  const localeOptions = locales.includes(locale) ? locales : [locale, ...locales];

  return (
    <>
      <PageHeading
        title="Pagina’s"
        description="Bewerk je inhoud in concept en publiceer wanneer alles klopt."
        actions={
          can(user.role, 'page.create') ? (
            <Button size="sm" render={<Link href="/admin/pages/new" />}>
              Nieuwe pagina
            </Button>
          ) : null
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <span className="admin-label text-muted-foreground">Taal:</span>
        {localeOptions.map((option) => (
          <Link
            key={option}
            href={`/admin/pages?locale=${option}${status ? `&status=${status}` : ''}`}
            aria-current={option === locale ? 'true' : undefined}
            className={option === locale ? FILTER_ACTIVE : FILTER_IDLE}
          >
            {option}
          </Link>
        ))}
        <span className="admin-label ml-3 text-muted-foreground">Status:</span>
        {[
          { value: '', label: 'alle' },
          { value: 'draft', label: 'concept' },
          { value: 'published', label: 'gepubliceerd' },
        ].map((option) => (
          <Link
            key={option.value || 'all'}
            href={`/admin/pages?locale=${locale}${option.value ? `&status=${option.value}` : ''}`}
            aria-current={(status ?? '') === option.value ? 'true' : undefined}
            className={(status ?? '') === option.value ? FILTER_ACTIVE : FILTER_IDLE}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Titel</th>
              <th className="p-3">Pad</th>
              <th className="p-3">Status</th>
              <th className="p-3">Gewijzigd</th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 ? (
              <tr>
                <td colSpan={4} className="p-6 text-center text-muted-foreground">
                  Geen pagina’s gevonden.
                </td>
              </tr>
            ) : null}
            {pages.map((page) => (
              <tr key={page.id} className="border-b border-border last:border-0">
                <td className="p-3">
                  <Link
                    href={`/admin/pages/${page.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {page.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{page.kind}</span>
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {publicPathFor(page.locale, page.slug)}
                </td>
                <td className="p-3">
                  <Badge
                    variant={page.status === 'published' ? 'success' : 'secondary'}
                    className={badgeTone(page.status === 'published' ? 'success' : 'secondary')}
                  >
                    {page.status === 'published' ? 'Gepubliceerd' : 'Concept'}
                  </Badge>
                  {page.noIndex ? (
                    <Badge variant="warning" className={cn('ml-1.5', badgeTone('warning'))}>
                      noindex
                    </Badge>
                  ) : null}
                </td>
                <td className="p-3 text-xs text-muted-foreground">
                  {new Date(page.updatedAt).toLocaleString('nl-BE')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
