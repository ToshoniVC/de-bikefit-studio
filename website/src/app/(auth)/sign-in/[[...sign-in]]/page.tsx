import { SignIn } from '@clerk/nextjs';
import { FeatureNotice } from '@/components/feature-notice';

const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <div className="flex justify-center px-4 py-16">
      {hasClerk ? (
        <SignIn />
      ) : (
        <FeatureNotice
          title="Auth not configured"
          body="Add your Clerk keys to .env.local to enable sign in and accounts."
        />
      )}
    </div>
  );
}
