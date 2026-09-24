import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listPages, publicPathFor } from '@/lib/cms/repo';
import { listPageLocales } from '@/lib/cms/repo-admin';

export const metadata = { title: 'Pagina’s' };

type Search = { locale?: string; status?: string };

export default async function AdminPagesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const user = await requireCmsUser();
  if (!can(user.role, 'page.read')) return <ForbiddenNotice what="de pagina’s" />;

  const { locale: localeParam, status } = await searchParams;
  const locales = await listPageLocales();
  const locale = localeParam || DEFAULT_LOCALE;

  const all = await listPages(locale);
  const pages = status === 'published' || status === 'draft'
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

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">Taal:</span>
        {localeOptions.map((option) => (
          <Link
            key={option}
            href={`/admin/pages?locale=${option}${status ? `&status=${status}` : ''}`}
            className={option === locale ? 'font-medium underline underline-offset-4' : 'underline underline-offset-4 opacity-60'}
          >
            {option}
          </Link>
        ))}
        <span className="ml-3 text-muted-foreground">Status:</span>
        {[
          { value: '', label: 'alle' },
          { value: 'draft', label: 'concept' },
          { value: 'published', label: 'gepubliceerd' },
        ].map((option) => (
          <Link
            key={option.value || 'all'}
            href={`/admin/pages?locale=${locale}${option.value ? `&status=${option.value}` : ''}`}
            className={
              (status ?? '') === option.value
                ? 'font-medium underline underline-offset-4'
                : 'underline underline-offset-4 opacity-60'
            }
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border/60 text-xs text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Titel</th>
              <th className="p-3 font-medium">Pad</th>
              <th className="p-3 font-medium">Status</th>
              <th className="p-3 font-medium">Gewijzigd</th>
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
              <tr key={page.id} className="border-b border-border/40 last:border-0">
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
                  <Badge variant={page.status === 'published' ? 'success' : 'secondary'}>
                    {page.status === 'published' ? 'Gepubliceerd' : 'Concept'}
                  </Badge>
                  {page.noIndex ? (
                    <Badge variant="warning" className="ml-1.5">
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
