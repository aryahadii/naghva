/** Stable ordering shared by derivation views and interactive catalogue controls. */
export function compareDates(a: { id: string; date?: string }, b: { id: string; date?: string }, newest = false): number {
  if (!a.date || !b.date) return a.date ? -1 : b.date ? 1 : a.id.localeCompare(b.id);
  return (newest ? -1 : 1) * a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}
