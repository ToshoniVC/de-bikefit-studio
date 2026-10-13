import { EmailServiceManager } from '@/components/admin/email-service-manager';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { SectionCard } from '@/components/admin/form';
import { StepUpPanel } from '@/components/admin/mfa/step-up';
import { PageHeading } from '@/components/admin/shell';
import { requireCmsUser } from '@/lib/cms/auth';
import { getStepUpStatus } from '@/lib/cms/mfa/reauth';
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
 *
 * Changing the key or the addresses needs a recent step-up, enforced in
 * `src/lib/email/repo.ts`; the panel above the forms is only the way to get it.
 */
export default async function AdminEmailPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'email.manage')) return <ForbiddenNotice what="de e-mailinstellingen" />;

  const status = await getEmailServiceStatus();
  const stepUp = await getStepUpStatus();
  const keyUpdated = status.apiKey.updatedAt
    ? STAMP.format(new Date(status.apiKey.updatedAt))
    : null;

  return (
    <>
      <PageHeading
        title="E-mail"
        description="De e-maildienst (Resend) achter de afspraakbevestigingen en de cadeaubonbestellingen. Alleen beheerders zien en wijzigen dit."
      />
      <div className="mb-4">
        <SectionCard
          title="Bevestig je identiteit"
          description="De API-sleutel, de afzender, het antwoordadres en de ontvanger van cadeaubonbestellingen wijzigen vraagt een recente bevestiging. Een testbericht versturen kan zonder."
        >
          <StepUpPanel
            until={stepUp.until ? stepUp.until.toISOString() : null}
            needsCode={stepUp.needsCode}
            what="de e-mailinstellingen wijzigen"
          />
        </SectionCard>
      </div>
      <EmailServiceManager status={status} keyUpdated={keyUpdated} adminEmail={user.email} />
    </>
  );
}
