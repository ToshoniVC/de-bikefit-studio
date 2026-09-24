import { ForbiddenNotice } from '@/components/admin/forbidden';
import { NavigationEditor } from '@/components/admin/navigation-editor';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { getNavigation } from '@/lib/cms/content';
import { can } from '@/lib/cms/permissions';

export const metadata = { title: 'Menu’s' };

export default async function AdminNavigationPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const user = await requireCmsUser();
  if (!can(user.role, 'navigation.read')) return <ForbiddenNotice what="de menu’s" />;

  const { locale: localeParam } = await searchParams;
  const locale = localeParam || DEFAULT_LOCALE;
  const canEdit = can(user.role, 'navigation.update');

  const [main, footer] = await Promise.all([
    getNavigation(locale, 'main'),
    getNavigation(locale, 'footer'),
  ]);

  return (
    <>
      <PageHeading title="Menu’s" description={`Hoofdmenu en footer voor taal “${locale}”.`} />

      <div className="flex flex-col gap-4">
        <NavigationEditor
          locale={locale}
          menuKey="main"
          title="Hoofdmenu"
          description="De navigatie bovenaan. Eén niveau subitems is mogelijk."
          initialItems={main}
          canEdit={canEdit}
        />
        <NavigationEditor
          locale={locale}
          menuKey="footer"
          title="Footer"
          description="Gebruik het veld “groep” om kolommen te maken (Studio, Bikefits, Contact)."
          initialItems={footer}
          canEdit={canEdit}
        />
      </div>
    </>
  );
}
