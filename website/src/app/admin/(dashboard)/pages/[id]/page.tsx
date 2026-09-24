import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { BlockEditor } from '@/components/admin/blocks/block-editor';
import { allBlockSpecs } from '@/components/admin/blocks/field-spec';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { SectionCard } from '@/components/admin/form';
import { PageDeleteForm, PagePublishActions } from '@/components/admin/page-actions';
import { PageSettingsForm } from '@/components/admin/page-settings-form';
import { PageHeading } from '@/components/admin/shell';
import type { MediaOption } from '@/components/admin/media-picker';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { getPageForEdit, listMedia, publicPathFor } from '@/lib/cms/repo';

export const metadata = { title: 'Pagina bewerken' };

export default async function EditPagePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCmsUser();
  if (!can(user.role, 'page.read')) return <ForbiddenNotice what="de pagina’s" />;

  // Next 16: route params are async.
  const { id } = await params;
  const result = await getPageForEdit(id);
  if (!result) notFound();

  const { page, blocks } = result;
  const media: MediaOption[] = can(user.role, 'media.read')
    ? (await listMedia()).map((item) => ({
        id: item.id,
        filename: item.filename,
        mimeType: item.mimeType,
        alt: item.alt?.[DEFAULT_LOCALE] ?? '',
      }))
    : [];

  const publicPath = publicPathFor(page.locale, page.slug);
  const canEdit = can(user.role, 'page.update');

  return (
    <>
      <PageHeading
        title={page.title}
        description={`${page.locale} · ${publicPath}`}
        actions={
          <>
            <Badge variant={page.status === 'published' ? 'success' : 'secondary'}>
              {page.status === 'published' ? 'Gepubliceerd' : 'Concept'}
            </Badge>
            {page.status === 'published' ? (
              <Link
                href={publicPath}
                className="text-xs underline underline-offset-4"
                target="_blank"
                rel="noreferrer"
              >
                Bekijk pagina
              </Link>
            ) : null}
            <Link href="/admin/pages" className="text-xs underline underline-offset-4">
              Alle pagina’s
            </Link>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <SectionCard
          title="Publiceren"
          description={
            page.status === 'published'
              ? `Laatst gepubliceerd op ${page.publishedAt ? new Date(page.publishedAt).toLocaleString('nl-BE') : '—'}. Wijzigingen zijn pas zichtbaar na opnieuw publiceren.`
              : 'Concepten zijn nooit zichtbaar voor bezoekers.'
          }
        >
          <PagePublishActions
            pageId={page.id}
            status={page.status}
            canPublish={can(user.role, 'page.publish')}
          />
        </SectionCard>

        <PageSettingsForm
          page={{
            id: page.id,
            slug: page.slug,
            title: page.title,
            kind: page.kind,
            translationGroup: page.translationGroup,
            metaTitle: page.metaTitle,
            metaDescription: page.metaDescription,
            canonicalOverride: page.canonicalOverride,
            ogTitle: page.ogTitle,
            ogDescription: page.ogDescription,
            ogImageMediaId: page.ogImageMediaId,
            noIndex: page.noIndex,
            structuredDataType: page.structuredDataType,
            structuredDataOverrides: page.structuredDataOverrides,
          }}
          media={media}
          canEdit={canEdit}
        />

        <section>
          <h2 className="mb-2 font-heading text-lg font-semibold">Blokken</h2>
          <BlockEditor
            pageId={page.id}
            blocks={blocks.map((block) => ({
              id: block.id,
              type: block.type,
              data: block.data,
            }))}
            specs={allBlockSpecs()}
            media={media}
            canEdit={can(user.role, 'block.update')}
          />
        </section>

        {can(user.role, 'page.delete') ? (
          <SectionCard
            title="Gevarenzone"
            description="Verwijderen kan niet ongedaan gemaakt worden."
          >
            <PageDeleteForm pageId={page.id} />
          </SectionCard>
        ) : null}
      </div>
    </>
  );
}
