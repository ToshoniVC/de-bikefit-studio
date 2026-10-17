import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ForbiddenNotice } from '@/components/admin/forbidden';
import { SectionCard } from '@/components/admin/form';
import { PageHeading } from '@/components/admin/shell';
import { badgeTone } from '@/components/admin/tones';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { formatDuration } from '@/lib/booking/format';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { OFFER_CATEGORY_LABELS } from '@/lib/offers/catalogue';
import { OFFERING_STATUS_LABELS } from '@/lib/offers/offering';
import {
  listOfferingsForAdmin,
  type AdminOffering,
  type AdminOfferingOverview,
} from '@/lib/offers/repo';

export const metadata = { title: 'Aanbod' };

function statusBadge(offering: AdminOffering): {
  label: string;
  tone: 'success' | 'warning' | 'secondary';
} {
  if (!offering.settings.isListed) return { label: 'Verborgen', tone: 'secondary' };
  if (offering.resolved.status === 'bookable')
    return { label: OFFERING_STATUS_LABELS.bookable, tone: 'success' };
  if (offering.resolved.status === 'unavailable') {
    return { label: `${OFFERING_STATUS_LABELS.unavailable}: geen aanbieder`, tone: 'warning' };
  }
  return { label: 'Op aanvraag (formulier)', tone: 'secondary' };
}

function variantsLine(offering: AdminOffering): string {
  const parts = offering.resolved.variants.map((variant) => {
    const duration =
      variant.durationMinutes != null ? formatDuration(variant.durationMinutes) : '—';
    return variant.label ? `${variant.label}: ${duration}` : duration;
  });
  return offering.settings.bookingMode === 'direct' ? parts.join(' · ') : 'op aanvraag';
}

/**
 * Beheer → Aanbod (`offering.manage`, admin): every offering, shown or not.
 * The offering IS the offer: its text, visibility, variants, prices and
 * booking services are edited on its own screen; changes go live at once.
 */
export default async function AdminOfferingsPage() {
  const user = await requireCmsUser();
  if (!can(user.role, 'offering.manage')) return <ForbiddenNotice what="het aanbod" />;

  let overview: AdminOfferingOverview | null = null;
  try {
    overview = await listOfferingsForAdmin(DEFAULT_LOCALE);
  } catch {
    // A fixed code, never the error (a failed query's message holds its SQL).
    console.error('[cms] offerings_admin_unavailable');
  }

  return (
    <>
      <PageHeading
        title="Aanbod"
        description="Alles wat de studio aanbiedt, in één lijst: tekst, tonen of niet, Volwassene en Jeugd apart of één optie, duur en prijs per variant, en rechtstreeks online boeken of enkel op aanvraag. De website en de afspraakpagina volgen meteen. Aanbieders kiezen zelf wat ze aanbieden (Mijn agenda)."
        actions={
          <Button size="sm" render={<Link href="/admin/aanbod/nieuw" />}>
            Nieuw aanbod
          </Button>
        }
      />
      {overview ? (
        <div className="overflow-x-auto border border-border bg-card">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-border bg-muted text-xs text-muted-foreground">
              <tr>
                <th className="p-3">Aanbod</th>
                <th className="p-3">Categorie</th>
                <th className="p-3">Status</th>
                <th className="p-3">Duur</th>
                <th className="p-3">Prijs</th>
                <th className="p-3">Aanbieders</th>
              </tr>
            </thead>
            <tbody>
              {overview.offerings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-muted-foreground">
                    Nog geen aanbod. Maak het eerste aan, of draai{' '}
                    <code>npm run cms:bootstrap</code> voor de standaardinhoud.
                  </td>
                </tr>
              ) : null}
              {overview.offerings.map((offering) => {
                const badge = statusBadge(offering);
                const providers = new Set(
                  offering.resolved.variants.flatMap((variant) =>
                    variant.serviceId
                      ? (overview.services.find((service) => service.id === variant.serviceId)
                          ?.providerNames ?? [])
                      : [],
                  ),
                );
                return (
                  <tr key={offering.id} className="border-b border-border last:border-0">
                    <td className="p-3">
                      <Link
                        href={`/admin/aanbod/${offering.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {offering.content.title}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{offering.path}</span>
                    </td>
                    <td className="p-3 text-xs">
                      {OFFER_CATEGORY_LABELS[offering.content.category]}
                    </td>
                    <td className="p-3">
                      <Badge variant={badge.tone} className={badgeTone(badge.tone)}>
                        {badge.label}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs">{variantsLine(offering)}</td>
                    <td className="p-3 text-xs">
                      {offering.resolved.variants.length ? offeringPrice(offering) : '—'}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {providers.size > 0 ? [...providers].join(', ') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <SectionCard
          title="Aanbod niet beschikbaar"
          description="De gegevens konden niet geladen worden. Zijn migraties 0010 en 0011 (cms_offerings) al toegepast? Zie docs/staging-runbook.md."
        >
          <p className="text-sm text-muted-foreground">Probeer het later opnieuw.</p>
        </SectionCard>
      )}
    </>
  );
}

function offeringPrice(offering: AdminOffering): string {
  const priced = offering.resolved.variants.filter((variant) => variant.priceCents != null);
  if (priced.length === 0) return 'op aanvraag';
  return priced
    .map(
      (variant) =>
        `${variant.label ? `${variant.label} ` : ''}€ ${(variant.priceCents! / 100).toFixed(2).replace('.', ',')}`,
    )
    .join(' · ');
}
