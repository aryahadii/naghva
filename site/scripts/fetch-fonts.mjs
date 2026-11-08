// Puts the three Persian font files in src/assets/fonts before a build.
//
// The live site uses Farhang2 and IRANSansX from Fontiran, licensed to the
// owner, so the files are not in this repository. When
// NAGHVA_FONTS_URL is set (a private folder holding the owner's licensed
// copies, with NAGHVA_FONTS_TOKEN if it needs one), the files are downloaded
// from there. Otherwise the free Vazirmatn font stands in under the same file
// names, so anyone can build the site. Files already in place are kept.
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));
const vazirmatn = join(dirname(fileURLToPath(import.meta.resolve('@fontsource/vazirmatn/400.css'))), 'files');
const files = {
  'Farhang2-Bold.woff2': 700,
  'IRANSansXNoEn-Regular.woff2': 400,
  'IRANSansXNoEn-Bold.woff2': 700,
};

const exists = (path) => access(path).then(() => true, () => false);

await mkdir(dir, { recursive: true });
const base = process.env.NAGHVA_FONTS_URL;
const token = process.env.NAGHVA_FONTS_TOKEN;
for (const [name, weight] of Object.entries(files)) {
  const target = join(dir, name);
  if (base) {
    const url = new URL(name, base.endsWith('/') ? base : `${base}/`);
    const response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!response.ok) throw new Error(`fonts: ${name}: HTTP ${response.status} from NAGHVA_FONTS_URL`);
    await writeFile(target, Buffer.from(await response.arrayBuffer()));
  } else if (!(await exists(target))) {
    await copyFile(join(vazirmatn, `vazirmatn-arabic-${weight}-normal.woff2`), target);
    console.log(`fonts: ${name} is Vazirmatn (set NAGHVA_FONTS_URL for the licensed font)`);
  }
}
