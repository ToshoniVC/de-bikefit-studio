import { ForbiddenNotice } from '@/components/admin/forbidden';
import { MediaManager, type MediaItem } from '@/components/admin/media-manager';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { listMedia } from '@/lib/cms/repo';

export const metadata = { title: 'Media' };

export default async function AdminMediaPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'media.read')) return <ForbiddenNotice what="de mediabibliotheek" />;

  // Include soft-deleted rows so they can be restored; the bytes are never
  // hard-deleted, exactly so an old published snapshot keeps rendering.
  const items: MediaItem[] = (await listMedia(true)).map((item) => ({
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    sizeBytes: item.sizeBytes,
    alt: item.alt?.[DEFAULT_LOCALE] ?? '',
    createdAt: new Date(item.createdAt).toISOString(),
    isDeleted: item.deletedAt !== null,
  }));

  return (
    <>
      <PageHeading
        title="Media"
        description="Afbeeldingen voor blokken, OG-tags en het logo. Verwijderen is altijd herstelbaar."
      />
      <MediaManager items={items} canUpload={can(user.role, 'media.create')} />
    </>
  );
}
