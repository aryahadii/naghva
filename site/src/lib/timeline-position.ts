const READING_LINE = 150;
let lastRead: HTMLElement | undefined;

const visibleEntries = () => [...document.querySelectorAll<HTMLElement>('.entry:not([hidden])')];
const atReadingLine = (entries: HTMLElement[]) => entries.find((entry) => {
  const box = entry.getBoundingClientRect();
  return box.top <= READING_LINE && box.bottom > READING_LINE;
});

/** Keep the last entry read when returning to the header to switch languages. */
export function rememberTimelinePosition(): void {
  const entry = atReadingLine(visibleEntries());
  if (entry) lastRead = entry;
}

/** Prefer the reading line, then the remembered entry while the header is visible. */
export function currentTimelineEntry(): HTMLElement | undefined {
  const entries = visibleEntries();
  const reading = atReadingLine(entries);
  if (reading) lastRead = reading;
  return reading ?? (lastRead && entries.includes(lastRead) ? lastRead : undefined)
    ?? entries.find((entry) => entry.getBoundingClientRect().bottom > READING_LINE) ?? entries.at(-1);
}
