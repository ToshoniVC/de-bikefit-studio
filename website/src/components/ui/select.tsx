import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Deliberately a native `<select>`: the admin only ever needs short, flat
 * option lists, and a native control keeps server-action forms working without
 * any client-side state.
 */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      data-slot="select"
      className={cn(
        'h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { Select };
