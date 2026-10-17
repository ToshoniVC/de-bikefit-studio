/**
 * Core of `npm run cms:migrate-aanbod` (and self-test section 14d): brings an
 * EXISTING database from offer pages to offerings (17 Oct 2026, "the offering
 * IS the offer"), and nothing else.
 *
 *   offer pages      every `cms_pages` row under `aanbod/` with an `offer`
 *                    block becomes one `cms_offerings` row: the block's text
 *                    (title, summary, intro, Doel, Inhoud, extra's, Duur,
 *                    image, category, order) plus the page's meta description;
 *                    its settings are the saved ones (a `cms_offerings` row for
 *                    that page) or, without a row, what the page derived
 *                    (`deriveLegacyOffering()`). The page is then deleted
 *                    (`repo.deletePage()`, backed up first).
 *   orphan services  an active `cms_services` row no offering books through
 *                    (Gezinspakket, Fit aan huis, Inspanningstest) becomes a
 *                    hidden offering, so it stays manageable in Beheer → Aanbod.
 *   /aanbod/cadeaubon  moves to /cadeaubon (the page keeps everything else)
 *                    and gets a 301; the gift voucher card is written onto the
 *                    catalogue block of /aanbod (`extraCards`), then published.
 *
 * Never touched: `cms_services`, `cms_provider_services`, `cms_bookings`
 * (`guardCounts()` before and after), menus, settings, users, other pages.
 * Dry run (default) is read-only: no session, no audit entry, a database
 * handle that refuses writes. The apply writes a JSON backup of every page it
 * deletes or changes FIRST, acts as the CLIs' admin in a short-lived session,
 * and audits `migrate.aanbod.apply`. Idempotent: a second run finds nothing.
 */
import type { DefaultOffering } from '@/lib/offers/defaults';
import { GIFT_VOUCHER_PAGE_SLUG } from '@/lib/gift-voucher/order';
import { isOfferCategory, OFFER_CTA_LABEL, OFFER_PAGE_PREFIX } from '@/lib/offers/catalogue';
import {
  settingsFromRows,
  type OfferingServiceInfo,
  type OfferingSettings,
} from '@/lib/offers/offering';
import { validateOfferingContent, type OfferingContent } from '@/lib/offers/offering-content';
import { deriveLegacyOffering, legacyFieldsOf } from '@/lib/offers/offering-legacy';
import { CADEAUBON_CARD } from '@/lib/studio/seed-content/cadeaubon';
import { AANBOD_REDIRECTS } from '@/lib/studio/seed-content/navigation';
import {
  guardCounts,
  pagePath,
  rolloutBackupSchema,
  stable,
  writeBackup,
  type GuardCounts,
  type PlanDeps,
  type RolloutDeps,
} from './aanbod-rollout.mjs';
import {
  findActor,
  readOnlyDb,
  withAdminSession,
  type RolloutRunContext,
} from './aanbod-rollout-run.mjs';
import { draftBlocks, normalized, pageRow } from './page-cleanup-plan.mjs';

const OLD_VOUCHER_SLUG = `${OFFER_PAGE_PREFIX}/${GIFT_VOUCHER_PAGE_SLUG}`;
const VOUCHER_REDIRECT = AANBOD_REDIRECTS.find(
  (redirect) => redirect.fromPath === `/${OLD_VOUCHER_SLUG}`,
)!;

export type OfferPageMigration = {
  pageId: string;
  slug: string;
  path: string;
  status: 'draft' | 'published';
  offerSlug: string;
  title: string;
  /** `convert`: create the offering; `update`: fill the row saved for this page; `delete-only`: an offering with that slug already exists. */
  action: 'convert' | 'update' | 'delete-only';
  settingsSource: 'stored' | 'derived';
  storedId: string | null;
  content: OfferingContent | null;
  settings: OfferingSettings;
  notes: string[];
  problems: string[];
};

export type AanbodMigrationPlan = {
  locale: string;
  offerPages: OfferPageMigration[];
  orphanServices: { id: string; slug: string; name: string; description: string }[];
  voucher: { pageId: string | null; action: 'move' | 'unchanged' | 'absent' };
  redirect: {
    redirectId: string | null;
    action: 'create' | 'enable' | 'unchanged' | 'conflict';
    detail: string;
  };
  aanbod: {
    pageId: string | null;
    blockId: string | null;
    action: 'patch' | 'unchanged' | 'missing' | 'conflict';
    detail: string;
    unpublishedDraft: boolean;
    nextData: Record<string, unknown> | null;
  };
  guards: GuardCounts;
};

/** JSON with sorted object keys: Postgres `jsonb` does not keep key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : entry,
  );
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function list(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** The offering's copy from an `offer` block and its page; `null` with the reasons when it does not validate. */
export function contentFromOfferBlock(
  offerSlug: string,
  data: Record<string, unknown>,
  metaDescription: string | null,
): { content: OfferingContent | null; problems: string[] } {
  const category = text(data.category, 'bikefit');
  const ctaLabel = text(data.ctaLabel);
  const image = (data.image ?? null) as Record<string, unknown> | null;
  const result = validateOfferingContent({
    slug: offerSlug,
    category: isOfferCategory(category) ? category : 'bikefit',
    sortOrder: typeof data.sortOrder === 'number' ? data.sortOrder : 0,
    title: text(data.title, offerSlug),
    summary: text(data.summary),
    intro: text(data.intro),
    goal: text(data.goal),
    contents: list(data.contents),
    extras: list(data.extras),
    extrasNote: text(data.extrasNote),
    duration: text(data.duration),
    ctaLabel: ctaLabel === OFFER_CTA_LABEL ? '' : ctaLabel,
    image: {
      mediaId: typeof image?.mediaId === 'string' ? image.mediaId : null,
      url: typeof image?.url === 'string' ? image.url : null,
      alt: text(image?.alt),
      decorative: image?.decorative === true,
    },
    metaDescription: metaDescription ?? '',
  });
  return result.ok
    ? { content: result.data, problems: [] }
    : { content: null, problems: [result.message] };
}

/** The `offer` block of a page: the published version, else the draft. */
async function offerBlockOf(
  deps: PlanDeps,
  page: { id: string; status: string; publishedSnapshot: unknown },
) {
  const snapshot = page.publishedSnapshot as {
    blocks?: Array<{ type?: string; data?: unknown }>;
  } | null;
  const live = Array.isArray(snapshot?.blocks)
    ? snapshot.blocks.find((block) => block?.type === 'offer')
    : undefined;
  if (page.status === 'published' && live && live.data && typeof live.data === 'object') {
    return live.data as Record<string, unknown>;
  }
  const draft = (await draftBlocks(deps, page.id)).find((block) => block.type === 'offer');
  return draft ? draft.data : null;
}

export async function planAanbodMigration(deps: PlanDeps): Promise<AanbodMigrationPlan> {
  const { db, orm, schema, locale } = deps;
  const { and, asc, eq, like } = orm;
  const offeringSchema = await import('@/db/cms-offering-schema');
  const { cmsOfferings, cmsOfferingVariants } = offeringSchema;

  const services: OfferingServiceInfo[] = await db
    .select({
      id: schema.cmsServices.id,
      slug: schema.cmsServices.slug,
      name: schema.cmsServices.name,
      choiceLabel: schema.cmsServices.choiceLabel,
      durationMinutes: schema.cmsServices.durationMinutes,
      isActive: schema.cmsServices.isActive,
      requiresGuardian: schema.cmsServices.requiresGuardian,
      priceCents: schema.cmsServices.priceCents,
      showPrice: schema.cmsServices.showPrice,
    })
    .from(schema.cmsServices)
    .where(eq(schema.cmsServices.locale, locale));
  const descriptions = new Map(
    (
      await db
        .select({ id: schema.cmsServices.id, description: schema.cmsServices.description })
        .from(schema.cmsServices)
    ).map((row) => [row.id, row.description]),
  );

  const stored = await db.select().from(cmsOfferings).where(eq(cmsOfferings.locale, locale));
  const variantRows = await db.select().from(cmsOfferingVariants);
  const settingsOf = (row: (typeof stored)[number]) =>
    settingsFromRows(
      row,
      variantRows.filter((variant) => variant.offeringId === row.id),
    );
  const slugsTaken = new Set(stored.map((row) => row.slug).filter(Boolean));

  // --- offer pages -------------------------------------------------------------
  const pages = await db
    .select()
    .from(schema.cmsPages)
    .where(
      and(eq(schema.cmsPages.locale, locale), like(schema.cmsPages.slug, `${OFFER_PAGE_PREFIX}/%`)),
    )
    .orderBy(asc(schema.cmsPages.slug));
  const offerPages: OfferPageMigration[] = [];
  for (const page of pages) {
    const block = await offerBlockOf(deps, page);
    if (!block) continue; // the gift voucher and any other page under /aanbod/
    const offerSlug = page.slug.slice(OFFER_PAGE_PREFIX.length + 1);
    const row = stored.find((entry) => entry.pageId === page.id) ?? null;
    const derived = row ? null : deriveLegacyOffering(legacyFieldsOf(block), services);
    const settings = row ? settingsOf(row) : derived!.settings;
    const { content, problems } = contentFromOfferBlock(offerSlug, block, page.metaDescription);
    const clash = slugsTaken.has(offerSlug) && row?.slug !== offerSlug;
    offerPages.push({
      pageId: page.id,
      slug: page.slug,
      path: pagePath(page.slug),
      status: page.status,
      offerSlug,
      title: text(block.title, offerSlug),
      action: clash ? 'delete-only' : row ? 'update' : 'convert',
      settingsSource: row ? 'stored' : 'derived',
      storedId: row?.id ?? null,
      content,
      settings: page.status === 'published' ? settings : { ...settings, isListed: false },
      notes: [
        ...(derived?.notes ?? []),
        ...(page.status !== 'published'
          ? ['the page is a draft: the offering is created hidden']
          : []),
        ...(clash
          ? [`an offering with slug "${offerSlug}" already exists: the page is only deleted`]
          : []),
      ],
      problems,
    });
  }

  // --- services no offering books through ---------------------------------------
  const used = new Set<string>();
  for (const row of stored) {
    for (const variant of settingsOf(row).variants)
      if (variant.serviceId) used.add(variant.serviceId);
  }
  for (const page of offerPages) {
    for (const variant of page.settings.variants)
      if (variant.serviceId) used.add(variant.serviceId);
  }
  const orphanServices = services
    .filter((service) => service.isActive && !used.has(service.id) && !slugsTaken.has(service.slug))
    .filter((service) => !offerPages.some((page) => page.offerSlug === service.slug))
    .map((service) => ({
      id: service.id,
      slug: service.slug,
      name: service.name,
      description: descriptions.get(service.id) ?? '',
    }));

  // --- the gift voucher page and its redirect ------------------------------------
  const oldVoucher = await pageRow(deps, OLD_VOUCHER_SLUG);
  const newVoucher = await pageRow(deps, GIFT_VOUCHER_PAGE_SLUG);
  const voucher: AanbodMigrationPlan['voucher'] = oldVoucher
    ? newVoucher
      ? { pageId: oldVoucher.id, action: 'unchanged' }
      : { pageId: oldVoucher.id, action: 'move' }
    : { pageId: newVoucher?.id ?? null, action: newVoucher ? 'unchanged' : 'absent' };
  const [redirectRow] = await db
    .select()
    .from(schema.cmsRedirects)
    .where(eq(schema.cmsRedirects.fromPath, VOUCHER_REDIRECT.fromPath))
    .limit(1);
  let redirect: AanbodMigrationPlan['redirect'];
  if (!redirectRow) {
    redirect = {
      redirectId: null,
      action: 'create',
      detail: `${VOUCHER_REDIRECT.fromPath} → ${VOUCHER_REDIRECT.toPath} (301)`,
    };
  } else if (redirectRow.toPath !== VOUCHER_REDIRECT.toPath) {
    redirect = {
      redirectId: redirectRow.id,
      action: 'conflict',
      detail: `${redirectRow.fromPath} already redirects to ${redirectRow.toPath}`,
    };
  } else {
    redirect = {
      redirectId: redirectRow.id,
      action: redirectRow.isEnabled ? 'unchanged' : 'enable',
      detail: `${VOUCHER_REDIRECT.fromPath} → ${VOUCHER_REDIRECT.toPath}`,
    };
  }

  // --- /aanbod: the voucher card on the catalogue block --------------------------
  const aanbodRow = await pageRow(deps, OFFER_PAGE_PREFIX);
  let aanbod: AanbodMigrationPlan['aanbod'] = {
    pageId: null,
    blockId: null,
    action: 'missing',
    detail: '/aanbod is missing',
    unpublishedDraft: false,
    nextData: null,
  };
  if (aanbodRow) {
    const drafts = await draftBlocks(deps, aanbodRow.id);
    const live =
      (aanbodRow.publishedSnapshot as { blocks?: Array<{ type: string; data: unknown }> } | null)
        ?.blocks ?? [];
    const draft = normalized(deps, drafts);
    const unpublishedDraft =
      aanbodRow.status === 'published' && (draft === null || draft !== normalized(deps, live));
    const catalogue = drafts.filter((block) => block.type === 'offerCatalogue');
    if (catalogue.length !== 1) {
      aanbod = {
        pageId: aanbodRow.id,
        blockId: null,
        action: 'conflict',
        detail: `/aanbod: expected one offer catalogue, found ${catalogue.length}`,
        unpublishedDraft,
        nextData: null,
      };
    } else {
      const [block] = catalogue;
      const current = Array.isArray(block.data.extraCards) ? block.data.extraCards : [];
      const target = [CADEAUBON_CARD];
      if (canonical(current) === canonical(target)) {
        aanbod = {
          pageId: aanbodRow.id,
          blockId: block.id,
          action: aanbodRow.status === 'published' ? 'unchanged' : 'patch',
          detail: 'voucher card already on /aanbod',
          unpublishedDraft,
          nextData: aanbodRow.status === 'published' ? null : block.data,
        };
      } else if (current.length === 0) {
        aanbod = {
          pageId: aanbodRow.id,
          blockId: block.id,
          action: 'patch',
          detail: 'add the voucher card (extraCards) to the catalogue block, then publish',
          unpublishedDraft,
          nextData: { ...block.data, extraCards: target },
        };
      } else {
        aanbod = {
          pageId: aanbodRow.id,
          blockId: block.id,
          action: 'conflict',
          detail: `/aanbod: the catalogue block already has other extra cards (${current.length}); left untouched`,
          unpublishedDraft,
          nextData: null,
        };
      }
    }
  }

  return {
    locale,
    offerPages,
    orphanServices,
    voucher,
    redirect,
    aanbod,
    guards: await guardCounts(deps),
  };
}

export function aanbodMigrationHasChanges(plan: AanbodMigrationPlan): boolean {
  return (
    plan.offerPages.length > 0 ||
    plan.orphanServices.length > 0 ||
    plan.voucher.action === 'move' ||
    plan.redirect.action === 'create' ||
    plan.redirect.action === 'enable' ||
    plan.aanbod.action === 'patch'
  );
}

export function aanbodMigrationBlockers(plan: AanbodMigrationPlan): string[] {
  const blockers: string[] = [];
  for (const page of plan.offerPages) {
    for (const problem of page.problems) blockers.push(`page ${page.path}: ${problem}`);
  }
  if (plan.redirect.action === 'conflict') blockers.push(`redirect: ${plan.redirect.detail}`);
  if (plan.aanbod.action === 'conflict') blockers.push(plan.aanbod.detail);
  if (plan.aanbod.action === 'patch' && plan.aanbod.unpublishedDraft) {
    blockers.push(
      "page /aanbod: has unpublished draft edits; publish or discard them in /admin first (this tool never publishes an editor's draft)",
    );
  }
  return blockers;
}

export function printAanbodMigrationPlan(plan: AanbodMigrationPlan, log: PlanDeps['log']): void {
  log('=', `locale ${plan.locale}`);
  for (const page of plan.offerPages) {
    const symbol = page.problems.length ? '!' : page.action === 'delete-only' ? '-' : '+';
    log(
      symbol,
      `page ${page.path} (${page.title}) — ${
        page.action === 'delete-only'
          ? 'delete (offering exists)'
          : `${page.action === 'update' ? 'fill the saved offering' : 'create the offering'} from the page (${page.settingsSource} settings), then delete the page`
      }`,
    );
    for (const note of page.notes) log(' ', `  note: ${note}`);
    for (const problem of page.problems) log(' ', `  problem: ${problem}`);
  }
  for (const service of plan.orphanServices) {
    log('+', `service ${service.slug} (${service.name}) — hidden offering, booked as that service`);
  }
  log(
    plan.voucher.action === 'move' ? '~' : '=',
    `page /${OLD_VOUCHER_SLUG} — ${
      plan.voucher.action === 'move' ? `move to /${GIFT_VOUCHER_PAGE_SLUG}` : plan.voucher.action
    }`,
  );
  log(
    ['create', 'enable'].includes(plan.redirect.action)
      ? '+'
      : plan.redirect.action === 'conflict'
        ? '!'
        : '=',
    `redirect ${plan.redirect.detail} — ${plan.redirect.action}`,
  );
  log(
    plan.aanbod.action === 'patch' ? '~' : plan.aanbod.action === 'conflict' ? '!' : '=',
    `page /${OFFER_PAGE_PREFIX} — ${plan.aanbod.detail}${plan.aanbod.unpublishedDraft ? ' (WARNING: unpublished draft edits)' : ''}`,
  );
  log('=', `guards: ${stable(plan.guards)}`);
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function toJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

async function buildBackup(deps: PlanDeps, plan: AanbodMigrationPlan, driver: string) {
  const { db, orm, schema } = deps;
  const pageIds = [
    ...plan.offerPages.map((page) => page.pageId),
    ...(plan.voucher.action === 'move' && plan.voucher.pageId ? [plan.voucher.pageId] : []),
    ...(plan.aanbod.action === 'patch' && plan.aanbod.pageId ? [plan.aanbod.pageId] : []),
  ];
  const pages = [];
  for (const pageId of pageIds) {
    const [row] = await db.select().from(schema.cmsPages).where(orm.eq(schema.cmsPages.id, pageId));
    const blocks = await db
      .select()
      .from(schema.cmsBlocks)
      .where(orm.eq(schema.cmsBlocks.pageId, pageId))
      .orderBy(orm.asc(schema.cmsBlocks.sortOrder));
    pages.push({ row: toJson(row), blocks: blocks.map(toJson) });
  }
  return rolloutBackupSchema.parse({
    kind: 'aanbod-rollout-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    locale: deps.locale,
    driver,
    pages,
    menus: [],
    redirects: [],
    created: {
      pageSlugs: [],
      redirectPaths: plan.redirect.action === 'create' ? [VOUCHER_REDIRECT.fromPath] : [],
    },
    guards: plan.guards,
  });
}

type OfferingWrite = {
  content: OfferingContent;
  settings: OfferingSettings;
  pageId: string | null;
};

/** Inserts or (for a row saved for the page) fills one offering with its variants. */
async function writeOfferingRow(
  deps: RolloutDeps,
  write: OfferingWrite,
  existingId: string | null,
): Promise<string> {
  const { db, orm, locale, actor, auth } = deps;
  const { cmsOfferings, cmsOfferingVariants } = await import('@/db/cms-offering-schema');
  const { content, settings } = write;
  const columns = {
    slug: content.slug,
    category: content.category,
    sortOrder: content.sortOrder,
    title: content.title,
    summary: content.summary,
    intro: content.intro,
    goal: content.goal,
    contents: content.contents,
    extras: content.extras,
    extrasNote: content.extrasNote,
    duration: content.duration,
    ctaLabel: content.ctaLabel,
    image: content.image,
    metaDescription: content.metaDescription,
    pageId: null,
    isListed: settings.isListed,
    bookingMode: settings.bookingMode,
    variantMode: settings.variantMode,
    updatedBy: actor.id,
    updatedAt: new Date(),
  };
  let id = existingId;
  if (id) {
    await db.update(cmsOfferings).set(columns).where(orm.eq(cmsOfferings.id, id));
    await db.delete(cmsOfferingVariants).where(orm.eq(cmsOfferingVariants.offeringId, id));
  } else {
    const [row] = await db
      .insert(cmsOfferings)
      .values({ ...columns, locale })
      .returning({ id: cmsOfferings.id });
    id = row.id;
  }
  for (const variant of settings.variants) {
    await db.insert(cmsOfferingVariants).values({
      offeringId: id,
      audience: variant.audience,
      serviceId: variant.serviceId,
      priceCents: variant.priceCents,
    });
  }
  await auth.recordAudit(db, actor, {
    action: existingId ? 'offering.update' : 'offering.create',
    entityType: 'cms_offering',
    entityId: id,
    summary: `${content.title} (migratie van ${write.pageId ? 'de dienstpagina' : 'de dienst'})`,
    metadata: { slug: content.slug, source: write.pageId ? 'page' : 'service', settings },
  });
  return id;
}

export function orphanOffering(service: {
  slug: string;
  name: string;
  description: string;
  id: string;
}): OfferingWrite {
  const legacy: DefaultOffering['content'] = {
    slug: service.slug,
    category: service.slug === 'inspanningstest' ? 'begeleiding' : 'bikefit',
    sortOrder: 100,
    title: service.name,
    summary: service.description,
    intro: '',
    goal: '',
    contents: [],
    extras: [],
    extrasNote: '',
    duration: '',
    ctaLabel: '',
    image: { mediaId: null, url: null, alt: '', decorative: false },
    metaDescription: '',
  };
  return {
    content: legacy,
    settings: {
      isListed: false,
      bookingMode: 'direct',
      variantMode: 'single',
      variants: [{ audience: 'all', serviceId: service.id, priceCents: null }],
    },
    pageId: null,
  };
}

export type AanbodMigrationResult = { changed: boolean; backupPath: string | null };

export async function applyAanbodMigration(
  deps: RolloutDeps,
  options: { backupDir: string; driver: string },
): Promise<AanbodMigrationResult> {
  const { repo, log } = deps;
  const plan = await planAanbodMigration(deps);
  const blockers = aanbodMigrationBlockers(plan);
  if (blockers.length > 0) throw new Error(`migration refused:\n  - ${blockers.join('\n  - ')}`);
  if (!aanbodMigrationHasChanges(plan)) {
    log('=', 'nothing to do: the offer is already migrated');
    return { changed: false, backupPath: null };
  }

  // 1. Backup FIRST. No backup, no write.
  const backupPath = await writeBackup(
    await buildBackup(deps, plan, options.driver),
    options.backupDir,
    'aanbod-migrate',
  );
  const backupFile = backupPath.split(/[\\/]/).pop() ?? backupPath;
  log('✓', `backup written: ${backupPath}`);

  // 2. Offerings from the offer pages, then from the services no offering books through.
  const converted: string[] = [];
  for (const page of plan.offerPages) {
    if (page.action === 'delete-only' || !page.content) continue;
    await writeOfferingRow(
      deps,
      { content: page.content, settings: page.settings, pageId: page.pageId },
      page.action === 'update' ? page.storedId : null,
    );
    converted.push(page.offerSlug);
    log(
      '+',
      `offering ${page.offerSlug} — ${page.action === 'update' ? 'filled' : 'created'} from ${page.path}`,
    );
  }
  for (const service of plan.orphanServices) {
    await writeOfferingRow(deps, orphanOffering(service), null);
    log('+', `offering ${service.slug} — hidden, booked as service ${service.slug}`);
  }

  // 3. The gift voucher: the redirect before the move, so the old path never answers 404.
  if (plan.redirect.action === 'create') {
    const result = await repo.createRedirect(VOUCHER_REDIRECT);
    if (!result.ok) throw new Error(`redirect: ${result.message}`);
    log('+', `redirect ${plan.redirect.detail}`);
  } else if (plan.redirect.action === 'enable') {
    const result = await repo.updateRedirect(plan.redirect.redirectId!, {
      isEnabled: true,
      statusCode: VOUCHER_REDIRECT.statusCode,
    });
    if (!result.ok) throw new Error(`redirect: ${result.message}`);
    log('+', `redirect ${plan.redirect.detail} — enabled`);
  }
  if (plan.voucher.action === 'move' && plan.voucher.pageId) {
    const result = await repo.updatePage(plan.voucher.pageId, { slug: GIFT_VOUCHER_PAGE_SLUG });
    if (!result.ok) throw new Error(`page /${OLD_VOUCHER_SLUG}: ${result.message}`);
    log('~', `page /${OLD_VOUCHER_SLUG} — moved to /${GIFT_VOUCHER_PAGE_SLUG}`);
  }

  // 4. /aanbod: the voucher card, then publish (draft equals live, checked above).
  if (
    plan.aanbod.action === 'patch' &&
    plan.aanbod.pageId &&
    plan.aanbod.blockId &&
    plan.aanbod.nextData
  ) {
    const written = await repo.updateBlock(plan.aanbod.blockId, plan.aanbod.nextData);
    if (!written.ok) throw new Error(`page /${OFFER_PAGE_PREFIX}: ${written.message}`);
    const published = await repo.publishPage(plan.aanbod.pageId);
    if (!published.ok) throw new Error(`page /${OFFER_PAGE_PREFIX}: ${published.message}`);
    log('~', `page /${OFFER_PAGE_PREFIX} — voucher card added, published`);
  }

  // 5. The offer pages go last: their text is in the offerings now.
  for (const page of plan.offerPages) {
    const deleted = await repo.deletePage(page.pageId);
    if (!deleted.ok) throw new Error(`page ${page.path}: ${deleted.message}`);
    log('-', `page ${page.path} — deleted (in the backup)`);
  }

  // 6. Verify on what visitors get, and that the booking tables were not touched.
  const problems = await verifyAanbodMigration(deps, converted);
  if (problems.length > 0) throw new Error(`verification failed:\n  - ${problems.join('\n  - ')}`);
  log('✓', `offerings, /${GIFT_VOUCHER_PAGE_SLUG} and /${OFFER_PAGE_PREFIX} verified`);
  if (stable(await guardCounts(deps)) !== stable(plan.guards)) {
    throw new Error('booking tables changed during the migration!');
  }
  log('✓', 'bookings, services and providers unchanged');
  await deps.auth.recordAudit(deps.db, deps.actor, {
    action: 'migrate.aanbod.apply',
    entityType: 'cms_rollout',
    summary: 'offer pages → offerings (17 Oct 2026)',
    metadata: {
      backup: backupFile,
      pages: plan.offerPages.map((page) => page.path),
      offerings: converted,
      services: plan.orphanServices.map((service) => service.slug),
      voucher: plan.voucher.action,
      redirect: plan.redirect.action,
      aanbod: plan.aanbod.action,
    },
  });
  return { changed: true, backupPath };
}

/** Invariants after an apply (and in the self-test): the violations, empty when all is well. */
export async function verifyAanbodMigration(
  deps: PlanDeps,
  convertedSlugs: readonly string[],
): Promise<string[]> {
  const { db, orm, schema, locale } = deps;
  const { and, eq, like } = orm;
  const problems: string[] = [];
  const { loadOfferCatalogue } = await import('@/lib/cms/offers-content');
  const catalogue = await loadOfferCatalogue(locale);
  for (const slug of convertedSlugs) {
    if (!catalogue.bySlug[slug]) problems.push(`offering ${slug} is not in the catalogue`);
  }
  const leftovers = await db
    .select({ slug: schema.cmsPages.slug, snapshot: schema.cmsPages.publishedSnapshot })
    .from(schema.cmsPages)
    .where(
      and(eq(schema.cmsPages.locale, locale), like(schema.cmsPages.slug, `${OFFER_PAGE_PREFIX}/%`)),
    );
  for (const page of leftovers) {
    if (JSON.stringify(page.snapshot ?? '').includes('"type":"offer"')) {
      problems.push(`page /${page.slug} still exists with an offer block`);
    }
  }
  const { getPublishedPage } = await import('@/lib/cms/content');
  if (await pageRow(deps, OLD_VOUCHER_SLUG)) problems.push(`/${OLD_VOUCHER_SLUG} still exists`);
  const voucher = await pageRow(deps, GIFT_VOUCHER_PAGE_SLUG);
  if (
    voucher &&
    voucher.status === 'published' &&
    !(await getPublishedPage(locale, GIFT_VOUCHER_PAGE_SLUG))
  ) {
    problems.push(`/${GIFT_VOUCHER_PAGE_SLUG} does not render`);
  }
  const aanbod = await getPublishedPage(locale, OFFER_PAGE_PREFIX);
  if (aanbod) {
    const block = aanbod.snapshot.blocks.find((entry) => entry.type === 'offerCatalogue');
    const cards = (block?.data as { extraCards?: unknown[] } | undefined)?.extraCards ?? [];
    if (voucher && cards.length === 0) problems.push(`/${OFFER_PAGE_PREFIX}: no voucher card`);
  }
  return problems;
}

/**
 * Mode dispatch shared by the CLI and the self-test. The dry run plans against
 * `readOnlyDb()` and opens no session; `--apply` acts as the CLIs' admin
 * (`findActor()`) in a short-lived session, revoked afterwards.
 */
export async function runAanbodMigration(
  options: { apply: boolean; backupDir: string },
  context: RolloutRunContext,
): Promise<AanbodMigrationResult> {
  const schema = await import('@/db/cms-schema');
  const planDeps: PlanDeps = {
    db: options.apply ? context.db : readOnlyDb(context.db),
    orm: await import('drizzle-orm'),
    schema,
    blocks: await import('@/lib/cms/blocks'),
    locale: schema.DEFAULT_LOCALE,
    log: context.log,
  };
  const actor = await findActor(planDeps);

  if (!options.apply) {
    context.log('=', `would act as ${actor.email} (no session is created in a dry run)`);
    const plan = await planAanbodMigration(planDeps);
    printAanbodMigrationPlan(plan, context.log);
    const blockers = aanbodMigrationBlockers(plan);
    for (const blocker of blockers) context.log('!', blocker);
    const pending = aanbodMigrationHasChanges(plan);
    context.log(
      pending ? '→' : '=',
      pending
        ? `dry run: ${blockers.length > 0 ? 'blocked — fix the items marked ! first' : 'run again with --apply to write'}`
        : 'dry run: nothing to do',
    );
    return { changed: false, backupPath: null };
  }

  context.log('=', `acting as ${actor.email}`);
  return withAdminSession(context, actor.id, 'cms-migrate-aanbod', async () => {
    const deps: RolloutDeps = {
      ...planDeps,
      repo: await import('@/lib/cms/repo'),
      auth: await import('@/lib/cms/auth'),
      actor,
    };
    const result = await applyAanbodMigration(deps, {
      backupDir: options.backupDir,
      driver: context.driver,
    });
    context.log(
      '✓',
      result.changed
        ? `migration complete; backup: ${result.backupPath}`
        : 'migration complete; nothing changed',
    );
    return result;
  });
}

export { OLD_VOUCHER_SLUG, VOUCHER_REDIRECT };
