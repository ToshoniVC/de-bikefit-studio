import { EmailServiceManager } from '@/components/admin/email-service-manager';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { getEmailServiceStatus } from '@/lib/email/repo';

export const metadata = { title: 'E-mail' };

const STAMP = new Intl.DateTimeFormat('nl-BE', {
  timeZone: 'Europe/Brussels',
  dateStyle: 'short',
  timeStyle: 'short',
});

/**
 * Beheer → E-mail (admins only, `email.manage`): the e-mail service behind
 * booking confirmations and gift voucher orders. The client component gets a
 * status without the API key (`EmailServiceStatus`); see
 * `src/lib/email/config.ts`.
 */
export default async function AdminEmailPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'email.manage')) return <ForbiddenNotice what="de e-mailinstellingen" />;

  const status = await getEmailServiceStatus();
  const keyUpdated = status.apiKey.updatedAt
    ? STAMP.format(new Date(status.apiKey.updatedAt))
    : null;

  return (
    <>
      <PageHeading
        title="E-mail"
        description="De e-maildienst (Resend) achter de afspraakbevestigingen en de cadeaubonbestellingen. Alleen beheerders zien en wijzigen dit."
      />
      <EmailServiceManager status={status} keyUpdated={keyUpdated} adminEmail={user.email} />
    </>
  );
}
