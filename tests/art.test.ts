import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { REGIONS } from '../src/game/data';

test('every region has an illustration and a style that shows it', () => {
  const css = readFileSync('src/ui/styles/play.css', 'utf8');
  for (const r of REGIONS) {
    assert.ok(existsSync(`public/art/regions/${r.id}.webp`), `public/art/regions/${r.id}.webp`);
    assert.ok(css.includes(`.art-${r.id} {\n  background-image: url('/art/regions/${r.id}.webp');`), `.art-${r.id}`);
  }
});

test('the finish backdrops and the link preview card exist', () => {
  for (const file of ['ending-dawn.webp', 'ending-night.webp', 'og-card.jpg']) assert.ok(existsSync(`public/art/${file}`), file);
  assert.match(
    readFileSync('index.html', 'utf8'),
    /<meta property="og:image" content="https:\/\/aidong27\.github\.io\/food-chain-wilds\/art\/og-card\.jpg" \/>/,
  );
});
