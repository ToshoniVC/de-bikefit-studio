import 'server-only';
import {
  getBookingSettings,
  listPublicProviders,
  listPublicServices,
  type PublicLocation,
  type PublicProvider,
  type PublicService,
} from '@/lib/booking/content';
import type { BookingRules } from '@/lib/booking/settings';
import { todayYmd } from '@/lib/booking/time';
import type { BookingLocationOption, BookingProviderOption, BookingServiceOption } from './types';

/**
 * Server-side loader for the booking widget and the confirmation page: reads
 * through the public booking content API (`@/lib/booking/content`, the only
 * route to the booking tables from the public site) and maps its results onto
 * the widget's plain, serialisable props.
 */

export type BookingOptions = {
  services: BookingServiceOption[];
  providers: BookingProviderOption[];
  rules: BookingRules;
  todayYmd: string;
};

function toLocation(location: PublicLocation | null): BookingLocationOption | null {
  if (!location) return null;
  return {
    id: location.id,
    kind: location.kind === 'customer' ? 'customer' : 'studio',
    label: location.kind === 'customer' ? location.label || 'Bij jou thuis' : location.label,
  };
}

function toService(service: PublicService): BookingServiceOption {
  return {
    id: service.id,
    name: service.name,
    description: service.description,
    durationMinutes: service.durationMinutes,
    requiresGuardian: service.requiresGuardian,
    location: toLocation(service.location),
    priceLabel: service.priceLabel,
  };
}

function toProvider(
  provider: PublicProvider,
  serviceIds: ReadonlySet<string>,
): BookingProviderOption {
  return {
    id: provider.id,
    name: provider.displayName,
    bio: provider.bio,
    services: provider.services
      .filter((entry) => serviceIds.has(entry.serviceId))
      .map((entry) => ({ serviceId: entry.serviceId, location: toLocation(entry.location) })),
  };
}

/**
 * Bookable services (optionally narrowed and ordered by `serviceIds`, as the
 * `booking` block stores them), the providers offering them, the rules and
 * today's date in the booking time zone. Throws when the booking tables are
 * unreachable — callers render their own fallback.
 */
export async function loadBookingOptions(
  locale: string,
  serviceIds: readonly string[] = [],
): Promise<BookingOptions> {
  const [allServices, allProviders, rules] = await Promise.all([
    listPublicServices(locale),
    listPublicProviders(),
    getBookingSettings(locale),
  ]);

  const wanted = serviceIds.map((id) => id.trim()).filter(Boolean);
  const picked =
    wanted.length > 0
      ? wanted
          .map((id) => allServices.find((service) => service.id === id))
          .filter((service): service is PublicService => Boolean(service))
      : allServices;

  const services = picked.map(toService);
  const offered = new Set(services.map((service) => service.id));
  const providers = allProviders
    .map((provider) => toProvider(provider, offered))
    .filter((provider) => provider.services.length > 0);

  // A service nobody offers cannot be booked; `listPublicServices` already
  // filters on that, this keeps a narrowed list honest too.
  const bookable = services.filter((service) =>
    providers.some((provider) => provider.services.some((entry) => entry.serviceId === service.id)),
  );

  return {
    services: bookable,
    providers,
    rules,
    todayYmd: todayYmd(new Date(), rules.timezone),
  };
}
