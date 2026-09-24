'use client';

import { useActionState, useState } from 'react';

import { Select } from '@/components/ui/select';
import { ActionForm, StatusMessage, SubmitButton } from '@/components/admin/form';
import type { MediaOption } from '@/components/admin/media-picker';
import {
  addBlockAction,
  deleteBlockAction,
  moveBlockAction,
  updateBlockAction,
} from '@/lib/cms/actions/blocks';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import { BlockServicesContext, FieldInput, type BlockServiceOption } from './field-inputs';
import { defaultValueFor, type BlockSpec } from './field-spec';

export type EditorBlock = { id: string; type: string; data: unknown };

/**
 * Draft block editor: add from the registry, edit generated fields, move up or
 * down, delete, save. Publishing lives outside this component because it is
 * admin-only and validates every block server-side first.
 */
export function BlockEditor({
  pageId,
  blocks,
  specs,
  media,
  services = [],
  canEdit,
}: {
  pageId: string;
  blocks: EditorBlock[];
  specs: Record<string, BlockSpec>;
  media: MediaOption[];
  /** Booking services, for the `serviceIds` picker of the `booking` block. */
  services?: BlockServiceOption[];
  canEdit: boolean;
}) {
  const types = Object.values(specs);

  return (
    <BlockServicesContext value={services}>
      <div className="flex flex-col gap-3">
        {canEdit ? (
          <ActionForm
            action={addBlockAction}
            hidden={{ pageId }}
            className="border border-border bg-card p-4"
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex min-w-56 flex-1 flex-col gap-1">
                <label
                  htmlFor="add-block-type"
                  className="admin-label text-xs text-muted-foreground"
                >
                  Blok toevoegen
                </label>
                <Select id="add-block-type" name="type" defaultValue={types[0]?.type}>
                  {types.map((spec) => (
                    <option key={spec.type} value={spec.type}>
                      {spec.label} — {spec.description}
                    </option>
                  ))}
                </Select>
              </div>
              <SubmitButton>Toevoegen</SubmitButton>
            </div>
          </ActionForm>
        ) : null}

        {blocks.length === 0 ? (
          <p className="border border-dashed border-ds-bone-400 bg-muted p-8 text-center text-sm text-muted-foreground">
            Deze pagina heeft nog geen blokken.
          </p>
        ) : null}

        {blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            pageId={pageId}
            block={block}
            spec={specs[block.type]}
            media={media}
            canEdit={canEdit}
            isFirst={index === 0}
            isLast={index === blocks.length - 1}
            position={index + 1}
            total={blocks.length}
          />
        ))}
      </div>
    </BlockServicesContext>
  );
}

function BlockCard({
  pageId,
  block,
  spec,
  media,
  canEdit,
  isFirst,
  isLast,
  position,
  total,
}: {
  pageId: string;
  block: EditorBlock;
  spec: BlockSpec | undefined;
  media: MediaOption[];
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  position: number;
  total: number;
}) {
  const [data, setData] = useState<Record<string, unknown>>(() =>
    block.data && typeof block.data === 'object' && !Array.isArray(block.data)
      ? { ...(block.data as Record<string, unknown>) }
      : {},
  );
  const [state, formAction] = useActionState(updateBlockAction, IDLE_STATE);

  return (
    <section className="border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-ds-display text-base leading-none font-semibold text-muted-foreground tabular-nums">
            {position}/{total}
          </span>
          <h3 className="text-base leading-tight">{spec?.label ?? block.type}</h3>
          <code className="bg-background px-1 text-[10px] text-muted-foreground">{block.type}</code>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {canEdit ? (
            <>
              <ActionForm
                action={moveBlockAction}
                hidden={{ pageId, blockId: block.id, direction: 'up' }}
              >
                <SubmitButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Blok omhoog"
                  disabled={isFirst}
                >
                  ↑
                </SubmitButton>
              </ActionForm>
              <ActionForm
                action={moveBlockAction}
                hidden={{ pageId, blockId: block.id, direction: 'down' }}
              >
                <SubmitButton
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Blok omlaag"
                  disabled={isLast}
                >
                  ↓
                </SubmitButton>
              </ActionForm>
              <ActionForm action={deleteBlockAction} hidden={{ pageId, blockId: block.id }}>
                <SubmitButton
                  variant="destructive"
                  size="xs"
                  confirm="Dit blok verwijderen? De gepubliceerde versie verandert pas bij de volgende publicatie."
                >
                  Verwijderen
                </SubmitButton>
              </ActionForm>
            </>
          ) : null}
        </div>
      </header>

      {/*
        A native <details> rather than React state: the fields are then part of
        the server-rendered HTML, so the editor also works with JavaScript
        disabled (progressive enhancement), and there is one less thing to keep
        in sync.
      */}
      <details className="group/block">
        <summary className="admin-label cursor-pointer list-none px-4 py-2.5 text-xs text-primary select-none hover:text-ds-burgundy-800">
          <span className="group-open/block:hidden">▸ Inhoud bewerken</span>
          <span className="hidden group-open/block:inline">▾ Inklappen</span>
        </summary>

        <form action={formAction} className="flex flex-col gap-3 p-4 pt-1">
          <input type="hidden" name="pageId" value={pageId} />
          <input type="hidden" name="blockId" value={block.id} />
          <input type="hidden" name="data" value={JSON.stringify(data)} />

          {spec ? (
            spec.fields.map((field) => (
              <FieldInput
                key={field.name}
                spec={field}
                value={data[field.name] ?? defaultValueFor(field)}
                onChange={(next) => setData({ ...data, [field.name]: next })}
                media={media}
                id={`${block.id}-${field.name}`}
              />
            ))
          ) : (
            <p className="text-xs text-destructive">
              Onbekend bloktype “{block.type}” — dit blok blokkeert publiceren.
            </p>
          )}

          <StatusMessage state={state} />

          {canEdit ? (
            <div className="flex justify-end">
              <SubmitButton>Blok opslaan</SubmitButton>
            </div>
          ) : null}
        </form>
      </details>
    </section>
  );
}
