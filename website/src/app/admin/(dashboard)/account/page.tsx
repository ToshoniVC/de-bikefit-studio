import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { SectionCard } from '@/components/admin/form';
import { MfaAccountPanel } from '@/components/admin/mfa/account-panel';
import { PasswordForm } from '@/components/admin/password-form';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { getOwnMfaStatus } from '@/lib/cms/mfa/manage';
import { ROLE_LABELS } from '@/lib/cms/permissions';

export const metadata = { title: 'Mijn account' };

export default async function AdminAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ herstelcode?: string }>;
}) {
  const user = await requireCmsUser();
  const mfa = await getOwnMfaStatus();
  const { herstelcode } = await searchParams;

  return (
    <>
      <PageHeading
        title="Mijn account"
        description="Je gegevens, je wachtwoord en tweestapsverificatie."
      />

      <div className="flex flex-col gap-4">
        <SectionCard title="Gegevens">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="admin-label text-xs text-muted-foreground">Naam</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt className="admin-label text-xs text-muted-foreground">E-mailadres</dt>
              <dd className="break-all">{user.email}</dd>
            </div>
            <div>
              <dt className="admin-label text-xs text-muted-foreground">Rol</dt>
              <dd>
                <Badge variant={user.role === 'admin' ? 'default' : 'secondary'}>
                  {ROLE_LABELS[user.role]}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="admin-label text-xs text-muted-foreground">Laatst aangemeld</dt>
              <dd>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('nl-BE') : '—'}</dd>
            </div>
          </dl>
        </SectionCard>

        <SectionCard
          title="Wachtwoord wijzigen"
          description="Na het wijzigen worden alle andere sessies afgemeld."
        >
          <PasswordForm />
        </SectionCard>

        <SectionCard
          title="Tweestapsverificatie"
          description="Een code uit je authenticator-app bij elke aanmelding, naast je wachtwoord."
        >
          <MfaAccountPanel
            status={{
              enrolled: mfa.enrolled,
              required: mfa.required,
              confirmedAt: mfa.confirmedAt ? mfa.confirmedAt.toISOString() : null,
              recoveryCodesLeft: mfa.recoveryCodesLeft,
            }}
            recoveryCodeUsed={herstelcode === 'gebruikt'}
          />
        </SectionCard>

        <p className="text-sm">
          <Link href="/admin/logout" className="underline underline-offset-4 hover:text-primary">
            Afmelden op dit toestel
          </Link>
        </p>
      </div>
    </>
  );
}
