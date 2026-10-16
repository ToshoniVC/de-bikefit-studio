import { ForbiddenNotice } from '@/components/admin/forbidden';
import { SectionCard } from '@/components/admin/form';
import { OfferingsManager, type OfferingRow } from '@/components/admin/offerings-manager';
import { PageHeading } from '@/components/admin/shell';
import { DEFAULT_LOCALE } from '@/db/cms-schema';
import { requireCmsUser } from '@/lib/cms/auth';
import { can } from '@/lib/cms/permissions';
import { OFFER_CATEGORIES, OFFER_CATEGORY_LABELS } from '@/lib/offers/catalogue';
import { listOfferingsForAdmin, type AdminOfferingOverview } from '@/lib/offers/repo';

export const metadata = { title: 'Aanbod' };

/**
 * Beheer → Aanbod (`offering.manage`: editors and admins). Every offer page
 * under /aanbod/, draft or published, with its offering settings in one form.
 * Changes take effect at once, without the page's publish step.
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
        description="Per dienst uit het aanbod: tonen of niet, één optie of Volwassene en Jeugd apart, de prijs per variant, en rechtstreeks online boeken of enkel op aanvraag. Tekst en beeld bewerk je in Pagina’s; duur en ouderregel in Diensten; aanbieders kiezen zelf wat ze aanbieden."
      />
      {overview ? (
        <OfferingsManager
          offerings={overview.offerings
            .sort(
              (a, b) =>
                OFFER_CATEGORIES.indexOf(a.category) - OFFER_CATEGORIES.indexOf(b.category) ||
                a.sortOrder - b.sortOrder ||
                a.title.localeCompare(b.title, 'nl'),
            )
            .map((offering): OfferingRow => ({
              pageId: offering.pageId,
              title: offering.title,
              path: offering.path,
              categoryLabel: OFFER_CATEGORY_LABELS[offering.category],
              pageStatus: offering.pageStatus,
              source: offering.source,
              legacyNotes: offering.legacyNotes,
              isListed: offering.settings.isListed,
              bookingMode: offering.settings.bookingMode,
              variantMode: offering.settings.variantMode,
              variants: offering.settings.variants,
              status: offering.resolved.status,
            }))}
          services={overview.services.map((service) => ({
            id: service.id,
            name: service.name,
            durationMinutes: service.durationMinutes,
            isActive: service.isActive,
            requiresGuardian: service.requiresGuardian,
            providerCount: service.providerCount,
          }))}
        />
      ) : (
        <SectionCard
          title="Aanbod niet beschikbaar"
          description="De instellingen konden niet geladen worden. Is migratie 0010 (cms_offerings) al toegepast? Zie docs/staging-runbook.md."
        >
          <p className="text-sm text-muted-foreground">Probeer het later opnieuw.</p>
        </SectionCard>
      )}
    </>
  );
}
