'use client';

import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionCard, StatusMessage, SubmitButton } from '@/components/admin/form';
import { updateNavigationAction } from '@/lib/cms/actions/navigation';
import { IDLE_STATE } from '@/lib/cms/actions/state';

type Child = { label: string; href: string; external: boolean };
type Item = Child & { group: string; children: Child[] };

const emptyChild = (): Child => ({ label: '', href: '', external: false });
const emptyItem = (): Item => ({ ...emptyChild(), group: '', children: [] });

/**
 * Menu editor for one (locale, menu) pair. One level of children, matching
 * `navigationItemSchema`; the whole array is saved as a single JSON value.
 */
export function NavigationEditor({
  locale,
  menuKey,
  title,
  description,
  initialItems,
  canEdit,
}: {
  locale: string;
  menuKey: string;
  title: string;
  description: string;
  initialItems: Item[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [state, formAction] = useActionState(updateNavigationAction, IDLE_STATE);

  const patch = (index: number, partial: Partial<Item>) =>
    setItems(items.map((item, position) => (position === index ? { ...item, ...partial } : item)));

  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    setItems(next);
  };

  return (
    <SectionCard title={title} description={description}>
      <form action={formAction} className="flex flex-col gap-3">
        <input type="hidden" name="locale" value={locale} />
        <input type="hidden" name="menuKey" value={menuKey} />
        <input type="hidden" name="items" value={JSON.stringify(items)} />

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Dit menu is leeg.</p>
        ) : null}

        {items.map((item, index) => (
          <div key={index} className="border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="admin-label text-xs text-muted-foreground">Item {index + 1}</span>
              <div className="flex gap-1">
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Omhoog"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  aria-label="Omlaag"
                  disabled={index === items.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="destructive"
                  onClick={() => setItems(items.filter((_, position) => position !== index))}
                >
                  Verwijderen
                </Button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label>Label</Label>
                <Input
                  value={item.label}
                  onChange={(event) => patch(index, { label: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Link</Label>
                <Input
                  value={item.href}
                  onChange={(event) => patch(index, { href: event.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label>Groep (footerkolom)</Label>
                <Input
                  value={item.group}
                  onChange={(event) => patch(index, { group: event.target.value })}
                />
              </div>
            </div>

            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.external}
                onChange={(event) => patch(index, { external: event.target.checked })}
                className="size-4 rounded border-input accent-primary"
              />
              <span>Externe link</span>
            </label>

            <div className="mt-3 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <span className="admin-label text-xs text-muted-foreground">
                  Subitems ({item.children.length})
                </span>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => patch(index, { children: [...item.children, emptyChild()] })}
                >
                  + Subitem
                </Button>
              </div>

              {item.children.map((child, childIndex) => (
                <div key={childIndex} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Input
                    value={child.label}
                    placeholder="Label"
                    onChange={(event) =>
                      patch(index, {
                        children: item.children.map((existing, position) =>
                          position === childIndex
                            ? { ...existing, label: event.target.value }
                            : existing,
                        ),
                      })
                    }
                  />
                  <Input
                    value={child.href}
                    placeholder="/pad"
                    onChange={(event) =>
                      patch(index, {
                        children: item.children.map((existing, position) =>
                          position === childIndex
                            ? { ...existing, href: event.target.value }
                            : existing,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      patch(index, {
                        children: item.children.filter((_, position) => position !== childIndex),
                      })
                    }
                  >
                    Wissen
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}

        <StatusMessage state={state} />

        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setItems([...items, emptyItem()])}
            >
              + Menu-item
            </Button>
            <SubmitButton>Menu opslaan</SubmitButton>
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}
