/**
 * The share menu on an Artist page: copy the address, the device's share
 * sheet, and a 9:16 story image drawn here from the page's own photo, art and
 * fonts. Instagram reads no link previews in Stories, so on a phone the image
 * goes to the share sheet (and from there to Stories) while the address is
 * copied for a link sticker; elsewhere the image downloads.
 */

interface Story {
  lang: 'en' | 'fa';
  address: string;
  site: string;
  name: string;
  other: string | null;
  kicker: string;
  photo: { src: string; fallback: string | null } | null;
  art: { branch: string; frieze: string; wordmark: string };
  file: string;
}

const W = 1080;
const H = 1920;
const INK = '#15171c';
const IVORY = '#f7f3e8';
const IVORY_2 = 'rgb(247 243 232 / .72)';
const IVORY_3 = 'rgb(247 243 232 / .52)';
const COPPER = '#d6a477';
const PERSIAN = /[؀-ۿ]/;

function load(src: string, cors = false): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The artist's photo: Naghva's own copy, or the publisher's when it allows drawing. */
async function photoOf(story: Story) {
  if (!story.photo) return null;
  const sameOrigin = new URL(story.photo.src, location.href).origin === location.origin;
  return (await load(story.photo.src, !sameOrigin))
    ?? (story.photo.fallback ? await load(story.photo.fallback, true) : null);
}

const fontFor = (text: string, role: 'name' | 'small' | 'alt') => {
  const persian = PERSIAN.test(text);
  if (role === 'name') return persian ? ['700', 'Farhang2, serif'] : ['500', '"Newsreader Variable", Georgia, serif'];
  if (role === 'alt') return persian ? ['700', 'Farhang2, serif'] : ['500', '"DM Sans Variable", sans-serif'];
  return persian ? ['600', 'IRANSansX, "DM Sans Variable", sans-serif'] : ['600', '"DM Sans Variable", sans-serif'];
};

/** Sets the font for `text` at the largest size up to `max` that fits `width`. */
function fit(ctx: CanvasRenderingContext2D, text: string, role: 'name' | 'small' | 'alt', max: number, min: number, width: number) {
  const [weight, family] = fontFor(text, role);
  let size = max;
  for (; size > min; size -= 2) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = `${weight} ${size}px ${family}`;
  return size;
}

/** Breaks `text` into at most two lines that fit `width` at the current font, if one won't. */
function lines(ctx: CanvasRenderingContext2D, text: string, width: number) {
  if (ctx.measureText(text).width <= width) return [text];
  const words = text.split(' ');
  let best = [text];
  let worst = Infinity;
  for (let i = 1; i < words.length; i++) {
    const pair = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const widest = Math.max(...pair.map((l) => ctx.measureText(l).width));
    if (widest < worst) [best, worst] = [pair, widest];
  }
  return best;
}

function write(ctx: CanvasRenderingContext2D, text: string, y: number) {
  ctx.direction = PERSIAN.test(text) ? 'rtl' : 'ltr';
  ctx.fillText(text, W / 2, y);
}

async function draw(story: Story): Promise<Blob> {
  const rtl = story.lang === 'fa';
  const texts = [story.name, story.other ?? '', story.kicker, story.site];
  await Promise.all([
    ...texts.flatMap((s) => (['name', 'small', 'alt'] as const).map((role) => {
      const [weight, family] = fontFor(s, role);
      return document.fonts.load(`${weight} 40px ${family.split(',')[0]}`, s || 'a').catch(() => null);
    })),
  ]);
  const [photo, branch, frieze, wordmark] = await Promise.all([
    photoOf(story), load(story.art.branch), load(story.art.frieze), load(story.art.wordmark),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  // The night sky: a cobalt glow behind the photo, fading to ink.
  const glow = ctx.createRadialGradient(W / 2, 760, 40, W / 2, 760, 980);
  glow.addColorStop(0, 'rgb(69 91 219 / .26)');
  glow.addColorStop(.55, 'rgb(69 91 219 / .08)');
  glow.addColorStop(1, 'rgb(69 91 219 / 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // The nightingale on its branch in the top corner, as on the site.
  if (branch) {
    const bw = 600;
    const bh = bw * branch.height / branch.width;
    ctx.save();
    ctx.globalAlpha = .9;
    if (rtl) ctx.drawImage(branch, -40, 60, bw, bh);
    else {
      ctx.translate(W + 40, 60);
      ctx.scale(-1, 1);
      ctx.drawImage(branch, 0, 0, bw, bh);
    }
    ctx.restore();
  }
  // The photo, whole, in the middle.
  let y = 340;
  if (photo) {
    const maxW = 820;
    const maxH = 680;
    const scale = Math.min(maxW / photo.naturalWidth, maxH / photo.naturalHeight);
    const pw = Math.round(photo.naturalWidth * scale);
    const ph = Math.round(photo.naturalHeight * scale);
    const px = (W - pw) / 2;
    const py = y + (maxH - ph) / 2;
    ctx.save();
    ctx.shadowColor = 'rgb(0 0 0 / .6)';
    ctx.shadowBlur = 80;
    ctx.shadowOffsetY = 30;
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 22);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(px, py, pw, ph, 22);
    ctx.clip();
    ctx.drawImage(photo, px, py, pw, ph);
    ctx.restore();
    y = py + ph + 100;
  } else {
    y = 860;
  }

  // Kicker, name and the name in the other script.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = COPPER;
  fit(ctx, story.kicker, 'small', rtl ? 36 : 30, 20, 900);
  if ('letterSpacing' in ctx && !PERSIAN.test(story.kicker)) ctx.letterSpacing = '5px';
  write(ctx, PERSIAN.test(story.kicker) ? story.kicker : story.kicker.toUpperCase(), y);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  ctx.fillStyle = IVORY;
  const persianName = PERSIAN.test(story.name);
  const largest = photo ? 112 : 150;
  let size = fit(ctx, story.name, 'name', largest, 64, 920);
  let rows = [story.name];
  // A long name takes two balanced lines rather than shrinking past reading size.
  if (size < 84 && story.name.includes(' ')) {
    fit(ctx, story.name, 'name', largest, largest, Infinity);
    rows = lines(ctx, story.name, 920);
    size = Math.min(...rows.map((r) => fit(ctx, r, 'name', largest, 56, 920)));
    const [weight, family] = fontFor(story.name, 'name');
    ctx.font = `${weight} ${size}px ${family}`;
  }
  // A name with no space to break at shrinks further rather than overflow.
  if (rows.length === 1 && ctx.measureText(story.name).width > 920) size = fit(ctx, story.name, 'name', size, 36, 920);
  const leading = size * (persianName ? 1.45 : 1.1);
  y += 40 + size * (persianName ? 1.05 : .95);
  for (const row of rows) {
    write(ctx, row, y);
    y += leading;
  }
  y -= leading;
  if (story.other) {
    ctx.fillStyle = IVORY_2;
    const altPersian = PERSIAN.test(story.other);
    const s = fit(ctx, altPersian ? story.other : story.other.toUpperCase(), 'alt', altPersian ? 54 : 32, 22, 900);
    if (!altPersian && 'letterSpacing' in ctx) ctx.letterSpacing = '4px';
    y += size * (persianName ? .5 : .3) + s * (altPersian ? 1.5 : 1.6);
    write(ctx, altPersian ? story.other : story.other.toUpperCase(), y);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  // The garden along the foot; above it, clear of Instagram's own bars, the wordmark and the address.
  const fh = frieze ? W * frieze.height / frieze.width : 150;
  const fy = H - fh - 60;
  if (frieze) {
    ctx.save();
    ctx.globalAlpha = .75;
    ctx.drawImage(frieze, 0, fy, W, fh);
    ctx.restore();
  }
  if (wordmark) {
    const wh = 72;
    const ww = wh * 620 / 470;
    ctx.drawImage(wordmark, (W - ww) / 2, fy - 230, ww, wh);
  }
  ctx.fillStyle = IVORY_3;
  fit(ctx, story.site, 'small', 28, 20, 900);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '3px';
  write(ctx, story.site, fy - 112);
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

const menu = document.getElementById('share-menu') as HTMLElement | null;
const trigger = document.querySelector<HTMLButtonElement>('.share-open');
if (menu && trigger) {
  const story = JSON.parse(menu.dataset.story!) as Story;
  const storyButton = menu.querySelector<HTMLButtonElement>('.share-story')!;
  const copy = menu.querySelector<HTMLButtonElement>('.share-copy')!;
  const copyLabel = copy.querySelector('span')!;
  const address = menu.querySelector<HTMLElement>('.share-address')!;
  const moreItem = menu.querySelector<HTMLElement>('.share-more-item')!;
  const more = menu.querySelector<HTMLButtonElement>('.share-more')!;
  const note = menu.querySelector<HTMLElement>('.share-note')!;
  const title = document.title;

  // The image is drawn once, when the menu first opens, so that a tap on
  // the story button can hand it to the share sheet at once: Safari refuses
  // a share that waits on work started by the tap.
  let file: File | null = null;
  let drawing: Promise<File | null> | null = null;
  const prepare = () => drawing ??= draw(story).then(
    (blob) => (file = new File([blob], story.file, { type: 'image/png' })),
    () => null,
  );
  const sharesFiles = (f: File) => typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] });
  // Phones share the image; computers, which rarely post Stories, download it.
  const phone = matchMedia('(pointer: coarse)').matches;

  if (typeof navigator.share === 'function') moreItem.hidden = false;

  const place = () => {
    if (innerWidth < 560) {
      menu.style.left = menu.style.top = '';
      return;
    }
    const r = trigger.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    const left = document.documentElement.dir === 'rtl' ? r.right - w : r.left;
    menu.style.left = `${Math.max(12, Math.min(left, innerWidth - w - 12))}px`;
    const below = r.bottom + 10;
    menu.style.top = `${below + h > innerHeight - 12 ? Math.max(12, r.top - h - 10) : below}px`;
  };

  const say = (text: string) => { note.textContent = text; place(); };

  menu.addEventListener('toggle', (event) => {
    const open = (event as ToggleEvent).newState === 'open';
    trigger.setAttribute('aria-expanded', String(open));
    if (!open) return;
    note.textContent = '';
    place();
    void prepare().then((f) => { if (!f) storyButton.setAttribute('aria-disabled', 'true'); });
    // Opened from the keyboard, focus moves into the menu.
    if (trigger.matches(':focus-visible')) menu.querySelector<HTMLElement>('.share-app:not([aria-disabled])')?.focus();
  });
  addEventListener('resize', () => menu.matches(':popover-open') && place());
  addEventListener('scroll', () => menu.matches(':popover-open') && place(), { passive: true });

  const copyAddress = () => navigator.clipboard?.writeText(story.address).then(() => true, () => false) ?? Promise.resolve(false);

  const download = (f: File) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  };

  const viaSheet = (f: File) => phone && sharesFiles(f);

  const shareStory = (f: File) => {
    // Copy first: the share sheet uses up the tap.
    const copied = copyAddress();
    if (viaSheet(f)) {
      navigator.share({ files: [f] }).catch((error) => {
        if (error?.name !== 'AbortError') say(note.dataset.failed!);
      });
      void copied.then((ok) => say(ok ? note.dataset.storyPhone! : note.dataset.storyPhoneNoCopy!));
    } else {
      download(f);
      void copied.then((ok) => say(ok ? note.dataset.storyDesktop! : note.dataset.storyDesktopNoCopy!));
    }
  };

  storyButton.addEventListener('click', () => {
    if (storyButton.getAttribute('aria-disabled') === 'true') return say(note.dataset.failed!);
    if (file) return shareStory(file);
    // Not drawn yet. A phone's share sheet must open straight from a tap, so
    // the reader taps again once it is ready; a download can simply follow.
    storyButton.setAttribute('aria-busy', 'true');
    say(note.dataset.preparing!);
    void prepare().then((f) => {
      storyButton.removeAttribute('aria-busy');
      if (!f) {
        storyButton.setAttribute('aria-disabled', 'true');
        return say(note.dataset.failed!);
      }
      if (viaSheet(f)) say('');
      else shareStory(f);
    });
  });

  let reset: ReturnType<typeof setTimeout> | undefined;
  copy.addEventListener('click', async () => {
    if (!(await copyAddress())) {
      // No clipboard access: select the address for the reader to copy.
      const range = document.createRange();
      range.selectNodeContents(address);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
      return say(note.dataset.copyManual!);
    }
    copy.classList.add('done');
    copyLabel.textContent = copy.dataset.done!;
    clearTimeout(reset);
    reset = setTimeout(() => {
      copy.classList.remove('done');
      copyLabel.textContent = copy.dataset.label!;
    }, 2000);
  });
  copy.dataset.label = copyLabel.textContent!;

  more.addEventListener('click', () => {
    navigator.share({ title, url: story.address }).catch(() => {});
  });

  // Warm the image when the reader reaches for the button.
  trigger.addEventListener('pointerenter', () => void prepare(), { once: true });
  trigger.addEventListener('focus', () => void prepare(), { once: true });
}
