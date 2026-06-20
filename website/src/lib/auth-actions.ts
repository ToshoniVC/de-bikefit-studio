'use server';

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { requireDb } from '@/db';
import { users } from '@/db/schema';
import { createSession, destroySession } from '@/lib/session';

/**
 * TEMPORARY email-only sign-in: enter an email and you're in (no password, no
 * verification). Creates the user if new. Replaced by Auth.js magic links in
 * Phase 2. See src/lib/session.ts for the security caveat.
 */
export async function signInWithEmail(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) {
    redirect('/sign-in?error=invalid');
  }

  const db = requireDb();
  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

  let userId: string;
  if (existing[0]) {
    userId = existing[0].id;
  } else {
    userId = crypto.randomUUID();
    await db.insert(users).values({ id: userId, email });
  }

  await createSession({ userId, email });
  redirect('/account');
}

export async function signOut(): Promise<void> {
  await destroySession();
  redirect('/');
}
