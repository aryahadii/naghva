interface Point { x: number; y: number }
export interface CometPath { key: string; from: Point; to: Point; highlighted: boolean; colour: string }

export const COMET_LIMIT = 4;

function fly(element: HTMLElement, path: CometPath): Animation {
  const { from, to, highlighted, colour } = path;
  const dx = to.x - from.x, dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const tail = Math.min(highlighted ? 100 : 64, distance * .62);
  const height = highlighted ? 1.8 : 1.1;
  const angle = Math.atan2(dy, dx);
  element.style.width = `${tail}px`;
  element.style.height = `${height}px`;
  element.style.color = colour;
  const peak = highlighted ? .8 : .38;
  // Grow the wake behind the head as it leaves the star, keeping both on the credit line.
  const offsets = [...new Set([0, .16, tail / distance, .76, 1])].sort((a, b) => a - b);
  const frames = offsets.map(t => ({
    offset: t,
    opacity: peak * Math.min(1, t / .16, (1 - t) / .24),
    transform: `translate3d(${from.x + dx*t - tail}px,${from.y + dy*t - height/2}px,0) rotate(${angle}rad) scaleX(${Math.min(1, t*distance/tail)})`,
  }));
  return element.animate(frames, { duration: 1700 + Math.min(distance, 250) * 2 + Math.random() * 900 });
}

/** One wake-up launches at most one trail. The compositor moves the live trails independently. */
export function skyComet(container: HTMLElement, pick: (occupied: ReadonlySet<string>) => CometPath | null) {
  const elements = Array.from(container.children) as HTMLElement[];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const flights = new Map<HTMLElement, Animation>();
  const occupied = new Set<string>();
  let inView = false;
  let timer = 0;

  function schedule() {
    if (inView && !document.hidden && !reduced.matches && flights.size < elements.length && !timer) {
      timer = window.setTimeout(launch, 350 + Math.random() * 650);
    }
  }
  function launch() {
    timer = 0;
    const element = elements.find(slot => !flights.has(slot));
    const path = element && pick(occupied);
    if (element && path) {
      const animation = fly(element, path);
      flights.set(element, animation);
      occupied.add(path.key);
      animation.onfinish = () => {
        occupied.delete(path.key);
        flights.delete(element);
        schedule();
      };
    }
    schedule();
  }
  function stop() {
    clearTimeout(timer);
    timer = 0;
    for (const flight of flights.values()) {
      flight.onfinish = null;
      flight.cancel();
    }
    flights.clear();
    occupied.clear();
  }
  function restart() {
    stop();
    schedule();
  }

  const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; restart(); });
  observer.observe(container.parentElement!);
  document.addEventListener('visibilitychange', restart);
  reduced.addEventListener('change', restart);
  return {
    interrupt() { if (flights.size) restart(); },
    dispose() {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', restart);
      reduced.removeEventListener('change', restart);
    },
  };
}
