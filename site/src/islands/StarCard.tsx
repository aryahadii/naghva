import { useState } from 'preact/hooks';
import { digits, scriptOf, type SkyStar } from '../lib/sky-data';

/**
 * What the star map says about the chosen star: its picture if it has one, its name in both
 * scripts, a fact or two, and how many stars it is linked to. A star with a
 * page of its own, or a recording on one, is a link to it.
 */

type Lang = 'en' | 'fa';
type Forms = { one: string; other: string };
export interface CardWords {
  recordings: Forms;
  members: Forms;
  groups: Forms;
  artists: Forms;
}
interface Props {
  star: SkyStar;
  stars: SkyStar[];
  lang: Lang;
  words: CardWords;
}

const attrs = (text: string, lang: Lang): { lang?: Lang; dir?: 'rtl' | 'ltr' } => {
  const script = scriptOf(text);
  return script === lang ? {} : { lang: script, dir: script === 'fa' ? 'rtl' : 'ltr' };
};

export default function StarCard({ star, stars, lang, words }: Props) {
  const [broken, setBroken] = useState(false);
  const recording = star.kind === 'recording';
  const linked = star.links.filter((index) => stars[index].kind === 'recording').length;
  const artists = star.links.length - linked;
  const rule = new Intl.PluralRules(lang === 'fa' ? 'fa-IR' : 'en-GB');
  const count = (forms: Forms, n: number) =>
    (rule.select(n) === 'one' ? forms.one : forms.other).replace('{count}', digits(lang, n));
  // An artist's line says where and when; a recording's says who it is by.
  const facts = recording ? star.by : [star.place, star.years].filter(Boolean).join(' · ');

  const head = (
    <>
      {star.image && !broken && (
        <span class="star-card-art">
          <img src={star.image} alt="" width="56" height="56" decoding="async" onError={() => setBroken(true)} />
        </span>
      )}
      <span class="star-card-text">
        {recording && star.years && <span class="star-card-year">{star.years}</span>}
        <span class="star-card-name" {...attrs(star.name, lang)}>{star.name}</span>
        {star.alternate && <span class="star-card-alt" {...attrs(star.alternate, lang)}>{star.alternate}</span>}
        {facts && <span class="star-card-facts" {...(recording ? attrs(facts, lang) : {})}>{facts}</span>}
      </span>
      {star.href && (
        <svg class="star-card-go" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" /></svg>
      )}
    </>
  );

  return (
    <div class="star-card-body" data-kind={star.kind}>
      {star.href ? <a class="star-card-head" href={star.href}>{head}</a> : <div class="star-card-head">{head}</div>}
      {star.links.length > 0 && (
        <p class="star-card-links">
          {linked > 0 && (
            <span><i class="star-mark recording" aria-hidden="true" />{count(words.recordings, linked)}</span>
          )}
          {artists > 0 && (
            <span>
              <i class="star-mark artist" aria-hidden="true" />
              {count(recording ? words.artists : star.group ? words.members : words.groups, artists)}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
