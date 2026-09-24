'use client';

import { Input } from '@/components/ui/input';
import { ActionForm, Field, SubmitButton } from '@/components/admin/form';
import {
  deletePageAction,
  publishPageAction,
  unpublishPageAction,
} from '@/lib/cms/actions/pages';

/**
 * Publish / unpublish / delete.
 *
 * `canPublish` only decides what is rendered — `repo.publishPage()` calls
 * `requirePermission('page.publish')`, so an editor posting this action
 * directly still gets "Je hebt geen toestemming voor deze actie."
 */
export function PagePublishActions({
  pageId,
  status,
  canPublish,
}: {
  pageId: string;
  status: 'draft' | 'published';
  canPublish: boolean;
}) {
  if (!canPublish) {
    return (
      <p className="text-xs text-muted-foreground">
        Publiceren kan alleen een beheerder. Sla je wijzigingen op en vraag een beheerder om de
        pagina te publiceren.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-start gap-2">
      <ActionForm action={publishPageAction} hidden={{ pageId }}>
        <SubmitButton size="lg">
          {status === 'published' ? 'Opnieuw publiceren' : 'Publiceren'}
        </SubmitButton>
      </ActionForm>

      {status === 'published' ? (
        <ActionForm action={unpublishPageAction} hidden={{ pageId }}>
          <SubmitButton
            size="lg"
            variant="outline"
            confirm="De pagina offline halen? De snapshot blijft bewaard."
          >
            Offline halen
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

export function PageDeleteForm({ pageId }: { pageId: string }) {
  return (
    <ActionForm action={deletePageAction} hidden={{ pageId }} className="max-w-sm">
      <Field
        label="Pagina verwijderen"
        htmlFor="confirm"
        hint="Typ VERWIJDER om te bevestigen. Dit verwijdert ook alle blokken."
      >
        <Input id="confirm" name="confirm" placeholder="VERWIJDER" />
      </Field>
      <div>
        <SubmitButton variant="destructive" confirm="Pagina definitief verwijderen?">
          Definitief verwijderen
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
