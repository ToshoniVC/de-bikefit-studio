/**
 * Initials for a team member without a portrait: the first letter of the
 * first two words, so "Robin Van Lierde" → "RV" and "Goran Van de Walle" →
 * "GV". Plain module, unit-tested.
 */
export function initialsFor(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? '');
  return letters.join('').toLocaleUpperCase('nl-BE');
}
