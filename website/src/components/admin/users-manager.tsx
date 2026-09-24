'use client';

import { useActionState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  ActionForm,
  Field,
  SectionCard,
  StatusMessage,
  SubmitButton,
} from '@/components/admin/form';
import { badgeTone } from '@/components/admin/tones';
import {
  createUserAction,
  resetUserPasswordAction,
  setUserActiveAction,
  setUserRoleAction,
} from '@/lib/cms/actions/users';
import { IDLE_STATE } from '@/lib/cms/actions/state';
import { ROLE_LABELS } from '@/lib/cms/permissions';
import type { CmsRole } from '@/db/cms-schema';

export type UserRow = {
  id: string;
  email: string;
  name: string;
  role: CmsRole;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
};

/**
 * User management. Temporary passwords are shown once, in the action result —
 * they are never stored in plaintext and password hashes never leave the
 * server.
 */
export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const [state, formAction] = useActionState(createUserAction, IDLE_STATE);

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Nieuwe gebruiker"
        description="De gebruiker krijgt een tijdelijk wachtwoord en moet dat bij de eerste aanmelding wijzigen."
      >
        <form action={formAction} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="E-mailadres" htmlFor="user-email">
              <Input id="user-email" name="email" type="email" required />
            </Field>
            <Field label="Naam" htmlFor="user-name">
              <Input id="user-name" name="name" required />
            </Field>
            <Field label="Rol" htmlFor="user-role">
              <Select id="user-role" name="role" defaultValue="editor">
                <option value="editor">{ROLE_LABELS.editor}</option>
                <option value="admin">{ROLE_LABELS.admin}</option>
                <option value="provider">{ROLE_LABELS.provider}</option>
              </Select>
            </Field>
            <Field
              label="Tijdelijk wachtwoord"
              htmlFor="user-password"
              hint="Leeg laten om er één te laten genereren."
            >
              <Input id="user-password" name="password" type="text" autoComplete="off" />
            </Field>
          </div>
          <StatusMessage state={state} />
          <div>
            <SubmitButton>Gebruiker aanmaken</SubmitButton>
          </div>
        </form>
      </SectionCard>

      <SectionCard title="Gebruikers" description={`${users.length} account(s).`}>
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <li key={user.id} className="border border-border bg-background p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{user.name}</span>
                <span className="text-xs text-muted-foreground">{user.email}</span>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                  {ROLE_LABELS[user.role]}
                </Badge>
                <Badge
                  variant={user.isActive ? 'success' : 'destructive'}
                  className={badgeTone(user.isActive ? 'success' : 'destructive')}
                >
                  {user.isActive ? 'Actief' : 'Gedeactiveerd'}
                </Badge>
                {user.mustChangePassword ? (
                  <Badge variant="warning" className={badgeTone('warning')}>
                    Moet wachtwoord wijzigen
                  </Badge>
                ) : null}
                {user.id === currentUserId ? <Badge variant="outline">Jijzelf</Badge> : null}
                <span className="text-xs text-muted-foreground">
                  {user.lastLoginAt
                    ? `Laatst aangemeld: ${new Date(user.lastLoginAt).toLocaleString('nl-BE')}`
                    : 'Nog nooit aangemeld'}
                </span>
              </div>

              <div className="flex flex-wrap items-start gap-3">
                <ActionForm action={setUserRoleAction} hidden={{ userId: user.id }}>
                  <div className="flex items-center gap-1.5">
                    <Select name="role" defaultValue={user.role} className="w-36">
                      <option value="editor">{ROLE_LABELS.editor}</option>
                      <option value="admin">{ROLE_LABELS.admin}</option>
                      <option value="provider">{ROLE_LABELS.provider}</option>
                    </Select>
                    <SubmitButton size="xs" variant="outline">
                      Rol opslaan
                    </SubmitButton>
                  </div>
                </ActionForm>

                <ActionForm
                  action={setUserActiveAction}
                  hidden={{ userId: user.id, isActive: user.isActive ? 'false' : 'true' }}
                >
                  <SubmitButton
                    size="xs"
                    variant={user.isActive ? 'destructive' : 'outline'}
                    confirm={
                      user.isActive
                        ? 'Account deactiveren? Alle sessies van deze gebruiker worden ingetrokken.'
                        : undefined
                    }
                  >
                    {user.isActive ? 'Deactiveren' : 'Heractiveren'}
                  </SubmitButton>
                </ActionForm>

                <ActionForm action={resetUserPasswordAction} hidden={{ userId: user.id }}>
                  <SubmitButton
                    size="xs"
                    variant="outline"
                    confirm="Een nieuw tijdelijk wachtwoord aanmaken? De huidige sessies worden ingetrokken."
                  >
                    Wachtwoord resetten
                  </SubmitButton>
                </ActionForm>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>
    </div>
  );
}
