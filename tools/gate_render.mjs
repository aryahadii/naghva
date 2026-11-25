// Print the text a browser shows for one page, then its title and meta
// contents, where platforms such as Spotify put a release's one-line summary.
// Used by the gate for pages that draw their text with scripts.
//
//     node tools/gate_render.mjs <url>
import { createRequire } from "node:module";

// Playwright is installed for the site, in site/node_modules.
let chromium;
for (const base of [import.meta.url, new URL("../site/package.json", import.meta.url)]) {
  try {
    ({ chromium } = createRequire(base)("playwright"));
    break;
  } catch {}
}
if (!chromium) {
  console.error("playwright is not installed");
  process.exit(2);
}

const url = process.argv[2];
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: "en-US" });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const text = await page.evaluate(() =>
    [document.body.innerText, document.title,
      ...[...document.querySelectorAll("meta[content]")].map((m) => m.content)].join("\n"),
  );
  process.stdout.write(text);
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  await browser.close();
}
