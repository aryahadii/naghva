interface Point { x: number; y: number }
export interface CometPath { from: Point; to: Point; highlighted: boolean; colour: string }

/** A single compositor animation, separated by irregular quiet intervals.
 * The star-field and label canvases do no work while the trail travels. */
export function skyComet(element: HTMLElement, pick: () => CometPath | null) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let inView = false;
  let timer = 0;
  let flight: Animation | null = null;

  function stop() {
    clearTimeout(timer);
    flight?.cancel();
    flight = null;
  }

  function wait() {
    stop();
    if (inView && !document.hidden && !reduced.matches) {
      timer = window.setTimeout(launch, 1100 + Math.random() * 4500);
    }
  }

  function launch() {
    const path = pick();
    if (!path) { wait(); return; }
    const { from, to, highlighted, colour } = path;
    const dx = to.x - from.x, dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const tail = Math.min(highlighted ? 34 : 22, distance * .32);
    const height = highlighted ? 1.8 : 1.1;
    const angle = Math.atan2(dy, dx);
    element.style.width = `${tail}px`;
    element.style.height = `${height}px`;
    element.style.color = colour;
    // The head is at the right-hand end of the gradient. Keep its entire tail
    // on the edge, including during the fade at either end.
    const transform = (t: number) => {
      const fraction = tail / distance + (1 - tail / distance) * t;
      return `translate3d(${from.x + dx * fraction - tail}px,${from.y + dy * fraction - height/2}px,0) rotate(${angle}rad)`;
    };
    const peak = highlighted ? .8 : .38;
    flight = element.animate([0, .18, .72, 1].map((t, index) => ({
      offset: t, transform: transform(t), opacity: index === 0 || index === 3 ? 0 : peak,
    })), { duration: 1250 + Math.min(distance, 250) * 2 + Math.random() * 900, easing: 'linear' });
    flight.onfinish = wait;
  }

  const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; wait(); });
  observer.observe(element.parentElement!);
  document.addEventListener('visibilitychange', wait);
  reduced.addEventListener('change', wait);
  return {
    interrupt() { if (flight) wait(); },
    dispose() {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', wait);
      reduced.removeEventListener('change', wait);
    },
  };
}
