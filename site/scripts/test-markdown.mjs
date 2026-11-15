import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderArticle } from '../src/lib/markdown.ts';

const citations = { run: (notes) => `<sup>${notes.length}</sup>` };
const render = (markdown) => renderArticle(markdown, 'en', [], citations);

test('raw HTML in an article is shown as text', () => {
  const html = render('Before <script>alert(1)</script> after.\n\n<iframe src="x"></iframe>');
  assert.doesNotMatch(html, /<script|<iframe/);
  assert.match(html, /&lt;script&gt;/);
});

test('links keep web, anchor and site paths, and drop other schemes', () => {
  assert.match(render('[a](https://example.com)'), /<a href="https:\/\/example.com">a<\/a>/);
  assert.match(render('[b](#sources)'), /<a href="#sources">b<\/a>/);
  assert.match(render('[c](/en/artists/x/)'), /<a href="\/en\/artists\/x\/">c<\/a>/);
  const bad = render('[d](javascript:alert(1)) [e](//evil.example/)');
  assert.doesNotMatch(bad, /<a /);
  assert.match(bad, /d/);
});
