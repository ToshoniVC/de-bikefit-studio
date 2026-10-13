import { ForbiddenNotice } from '@/components/admin/forbidden';
import { SettingsForms } from '@/components/admin/settings-forms';
import { PageHeading } from '@/components/admin/shell';
import type { MediaOption } from '@/components/admin/media-picker';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { getSiteSettings } from '@/lib/cms/content';
import { can } from '@/lib/cms/permissions';
import { listMedia } from '@/lib/cms/repo';

export const metadata = { title: 'Instellingen' };

export default async function AdminSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ locale?: string }>;
}) {
  const user = await requireCmsUser();
  if (!can(user.role, 'settings.read')) return <ForbiddenNotice what="de site-instellingen" />;

  const { locale: localeParam } = await searchParams;
  const locale = localeParam || DEFAULT_LOCALE;
  const settings = await getSiteSettings(locale);

  const media: MediaOption[] = can(user.role, 'media.read')
    ? (await listMedia()).map((item) => ({
        id: item.id,
        filename: item.filename,
        mimeType: item.mimeType,
        alt: item.alt?.[DEFAULT_LOCALE] ?? '',
      }))
    : [];

  return (
    <>
      <PageHeading
        title="Instellingen"
        description={`Site-brede waarden voor taal “${locale}”. Alleen beheerders kunnen ze wijzigen.`}
      />
      <SettingsForms
        settings={settings}
        locale={locale}
        media={media}
        canEdit={can(user.role, 'settings.update')}
      />
    </>
  );
}
