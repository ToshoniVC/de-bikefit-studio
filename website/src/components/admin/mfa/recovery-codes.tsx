'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Recovery codes, shown exactly once (they arrive in an action response and
 * live only in React state). Copying is offered; the codes are never sent
 * anywhere else.
 */
export function MfaRecoveryCodes({ codes }: { codes: string }) {
  const [copied, setCopied] = useState(false);
  const list = codes.split('\n').filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Bewaar deze {list.length} herstelcodes op een veilige plek, bijvoorbeeld in 1Password bij
        dit account. Elke code werkt één keer, als je je authenticator niet bij de hand hebt. Je
        ziet ze maar één keer.
      </p>
      <ul
        aria-label="Herstelcodes"
        className="grid grid-cols-1 gap-1 border border-border bg-muted p-3 font-mono text-sm sm:grid-cols-2"
      >
        {list.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(list.join('\n'));
              setCopied(true);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? 'Gekopieerd' : 'Kopieer de codes'}
        </Button>
      </div>
    </div>
  );
}
