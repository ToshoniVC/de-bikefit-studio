'use client';

import Image from 'next/image';
import { useActionState } from 'react';

import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  ActionForm,
  Field,
  SectionCard,
  StatusMessage,
  SubmitButton,
} from '@/components/admin/form';
import {
  deleteMediaAction,
  restoreMediaAction,
  updateMediaAltAction,
  uploadMediaAction,
} from '@/lib/cms/actions/media';
import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES } from '@/lib/cms/actions/media-limits';
import { IDLE_STATE } from '@/lib/cms/actions/state';

export type MediaItem = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  alt: string;
  createdAt: string;
  isDeleted: boolean;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MediaManager({ items, canUpload }: { items: MediaItem[]; canUpload: boolean }) {
  const [state, formAction] = useActionState(uploadMediaAction, IDLE_STATE);

  return (
    <div className="flex flex-col gap-4">
      {canUpload ? (
        <SectionCard
          title="Uploaden"
          description={`Max ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)} MB · JPEG, PNG, WebP, AVIF of SVG. Bestanden worden in de databank bewaard.`}
        >
          <form action={formAction} className="flex flex-col gap-3">
            <Field label="Bestand" htmlFor="file">
              <input
                id="file"
                name="file"
                type="file"
                accept={UPLOAD_ACCEPT}
                required
                className="text-xs file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
              />
            </Field>
            <Field label="Alt-tekst (nl)" htmlFor="alt" hint="Beschrijf wat er te zien is.">
              <Input id="alt" name="alt" />
            </Field>
            <StatusMessage state={state} />
            <div>
              <SubmitButton>Uploaden</SubmitButton>
            </div>
          </form>
        </SectionCard>
      ) : null}

      <SectionCard title="Bibliotheek" description={`${items.length} bestand(en).`}>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nog geen media.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-2 rounded-lg border border-border p-2.5"
              >
                <div className="flex items-start gap-2">
                  <Image
                    src={`/api/cms/media/${item.id}`}
                    alt={item.alt || item.filename}
                    width={64}
                    height={64}
                    unoptimized
                    className="size-16 rounded-md object-cover ring-1 ring-foreground/10"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium" title={item.filename}>
                      {item.filename}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {item.mimeType} · {formatBytes(item.sizeBytes)}
                    </p>
                    {item.isDeleted ? (
                      <Badge variant="destructive" className="mt-1">
                        Verwijderd
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <ActionForm action={updateMediaAltAction} hidden={{ mediaId: item.id }}>
                  <Input name="alt" defaultValue={item.alt} placeholder="Alt-tekst (nl)" />
                  <div className="flex flex-wrap gap-1.5">
                    <SubmitButton size="xs" variant="outline">
                      Alt opslaan
                    </SubmitButton>
                  </div>
                </ActionForm>

                {item.isDeleted ? (
                  <ActionForm action={restoreMediaAction} hidden={{ mediaId: item.id }}>
                    <SubmitButton size="xs" variant="outline">
                      Herstellen
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={deleteMediaAction} hidden={{ mediaId: item.id }}>
                    <SubmitButton
                      size="xs"
                      variant="destructive"
                      confirm="Bestand verwijderen? Het blijft herstelbaar."
                    >
                      Verwijderen
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
