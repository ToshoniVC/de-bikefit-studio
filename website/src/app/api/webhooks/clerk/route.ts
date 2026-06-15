import { NextResponse } from 'next/server';
import { Webhook } from 'svix';
import type { WebhookEvent } from '@clerk/nextjs/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';

/**
 * Clerk → Neon user sync. Configure a Clerk webhook pointing at
 * /api/webhooks/clerk with events: user.created, user.updated, user.deleted.
 * The signing secret goes in CLERK_WEBHOOK_SECRET.
 */
export async function POST(request: Request) {
  if (!env.CLERK_WEBHOOK_SECRET || !db) {
    return NextResponse.json({ error: 'Clerk sync is not configured.' }, { status: 501 });
  }

  const payload = await request.text();
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new NextResponse('Missing svix headers', { status: 400 });
  }

  let event: WebhookEvent;
  try {
    const wh = new Webhook(env.CLERK_WEBHOOK_SECRET);
    event = wh.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as WebhookEvent;
  } catch {
    return new NextResponse('Invalid signature', { status: 400 });
  }

  switch (event.type) {
    case 'user.created':
    case 'user.updated': {
      const { id, email_addresses, first_name, last_name } = event.data;
      const email = email_addresses?.[0]?.email_address;
      if (!email) break;
      await db
        .insert(users)
        .values({ id, email, firstName: first_name, lastName: last_name })
        .onConflictDoUpdate({
          target: users.id,
          set: { email, firstName: first_name, lastName: last_name },
        });
      break;
    }
    case 'user.deleted': {
      if (event.data.id) {
        await db.delete(users).where(eq(users.id, event.data.id));
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
