'use client';

import Image from 'next/image';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type MediaOption = {
  id: string;
  filename: string;
  mimeType: string;
  alt: string;
};

/**
 * Picks a `cms_media` id. Thumbnails come from the bytes route
 * (`/api/cms/media/<id>`), rendered unoptimised so SVG and AVIF work the same
 * as JPEG without going through the image optimiser.
 *
 * Works controlled (`onChange`) inside the block editor and uncontrolled
 * (`name`) inside a plain server-action form such as the SEO panel.
 */
export function MediaPicker({
  value,
  onChange,
  name,
  media,
  emptyLabel = 'Geen afbeelding gekozen',
}: {
  value: string | null;
  onChange?: (mediaId: string | null) => void;
  name?: string;
  media: MediaOption[];
  emptyLabel?: string;
}) {
  const [internal, setInternal] = useState<string | null>(value);
  const [open, setOpen] = useState(false);
  const current = onChange ? value : internal;
  const selected = media.find((item) => item.id === current) ?? null;

  const select = (mediaId: string | null) => {
    setInternal(mediaId);
    onChange?.(mediaId);
    setOpen(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {name ? <input type="hidden" name={name} value={current ?? ''} /> : null}

      <div className="flex items-center gap-2">
        {selected ? (
          <Image
            src={`/api/cms/media/${selected.id}`}
            alt={selected.alt || selected.filename}
            width={48}
            height={48}
            unoptimized
            className="size-12 rounded-md object-cover ring-1 ring-foreground/10"
          />
        ) : (
          <div className="admin-label flex size-12 items-center justify-center border border-dashed border-ds-bone-400 bg-muted text-[10px] text-muted-foreground">
            leeg
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-xs">{selected ? selected.filename : emptyLabel}</p>
          <div className="mt-1 flex gap-1.5">
            <Button type="button" size="xs" variant="outline" onClick={() => setOpen(!open)}>
              {open ? 'Sluiten' : 'Kiezen'}
            </Button>
            {current ? (
              <Button type="button" size="xs" variant="ghost" onClick={() => select(null)}>
                Wissen
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      {open ? (
        <div className="max-h-56 overflow-y-auto border border-border bg-background p-2">
          {media.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              Nog geen media. Upload eerst een bestand in de mediabibliotheek.
            </p>
          ) : (
            <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {media.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => select(item.id)}
                    title={item.filename}
                    className={cn(
                      'block w-full overflow-hidden rounded-md ring-1 ring-foreground/10 transition-opacity hover:opacity-80',
                      item.id === current && 'ring-2 ring-primary',
                    )}
                  >
                    <Image
                      src={`/api/cms/media/${item.id}`}
                      alt={item.alt || item.filename}
                      width={80}
                      height={80}
                      unoptimized
                      className="aspect-square w-full object-cover"
                    />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
