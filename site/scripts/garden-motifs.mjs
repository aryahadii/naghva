// The footer's GardenFrieze uses only three motifs of the design's original
// canvas. This cuts them out to a lossless WebP, keeping their coordinates.
// Run it only when garden-frieze.png changes: npm run art:motifs
import sharp from 'sharp';

await sharp('src/assets/art/garden-frieze.png').extract({ left: 0, top: 0, width: 388, height: 292 })
  .webp({ lossless: true, effort: 6 }).toFile('src/assets/art/garden-motifs.webp');
