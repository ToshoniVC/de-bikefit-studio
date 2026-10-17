/**
 * Who gets the "wijs deze afspraak toe" to-do (17 Oct 2026,
 * `booking-architecture.md` §16). Pure; tested in
 * `assignment-recipients.test.ts`.
 *
 *  1. the studio's order-and-enquiry inbox when one is set (env
 *     `GIFT_VOUCHER_RECIPIENT`, else `/admin/email` → *Ontvanger bestellingen
 *     en aanvragen*; `src/lib/gift-voucher/recipient.ts` validates it): the
 *     inbox that already receives the enquiries, so to-dos land in one place;
 *  2. else every active beheerder's login e-mail: they are the ones who can
 *     assign, and they sign in with those addresses;
 *  3. else nobody: the booking stands, the admin list still shows it under
 *     "Nog toe te wijzen".
 *
 * Never the public contact address (it may not receive mail yet), never the
 * provider who holds the slot (they are not the one deciding).
 */
export function assignmentRecipients(input: {
  /** The resolved inbox; '' when none or invalid. */
  inbox: string;
  /** Login e-mails of the active admins, in any order. */
  adminEmails: readonly string[];
}): string[] {
  const inbox = input.inbox.trim();
  if (inbox) return [inbox];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of input.adminEmails) {
    const email = raw.trim();
    const key = email.toLowerCase();
    if (!email || !email.includes('@') || seen.has(key)) continue;
    seen.add(key);
    list.push(email);
  }
  return list;
}
