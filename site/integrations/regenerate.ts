/** Debounce edits and serialize derivation; only the newest result may reload. */
export function regenerator(
  run: () => Promise<boolean>, reload: () => void, failed: () => void, delay = 300,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let revision = 0;
  let running = false;
  let ready = false;
  let disposed = false;

  async function drain() {
    if (running || !ready || disposed) return;
    ready = false;
    running = true;
    const started = revision;
    let success = false;
    try { success = await run(); } catch { /* Report spawn failures like exit failures. */ }
    running = false;
    if (disposed) return;
    if (!success) failed();
    if (started === revision && success) reload();
    void drain();
  }

  return {
    schedule() {
      if (disposed) return;
      revision++;
      ready = false;
      clearTimeout(timer);
      timer = setTimeout(() => { ready = true; void drain(); }, delay);
    },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
