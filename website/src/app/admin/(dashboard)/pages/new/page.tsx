import { ForbiddenNotice } from '@/components/admin/forbidden';
import { PageCreateForm } from '@/components/admin/page-create-form';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listPageLocales } from '@/lib/cms/repo-admin';

export const metadata = { title: 'Nieuwe pagina' };

export default async function NewPagePage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const user = await requireCmsUser();
  if (!can(user.role, 'page.create')) return <ForbiddenNotice what="het aanmaken van pagina’s" />;

  const { locale } = await searchParams;
  const existing = await listPageLocales();
  const locales = existing.includes(DEFAULT_LOCALE) ? existing : [DEFAULT_LOCALE, ...existing];

  return (
    <>
      <PageHeading
        title="Nieuwe pagina"
        description="De pagina start als concept en is pas zichtbaar na publicatie."
      />
      <PageCreateForm locales={locales} locale={locale || DEFAULT_LOCALE} />
    </>
  );
}
