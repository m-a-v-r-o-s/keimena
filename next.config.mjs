import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully static. No server actions, no route handlers, no env secrets --
  // this is what makes skipping the nextjs-boundary pass safe (PLAN.md section 4).
  // If a shop, newsletter backend or admin route is ever added, that skill runs first.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Pins the workspace root so Next stops inferring it from the unrelated
  // lockfile at ~/package-lock.json (a sibling "akos" project, not this repo).
  outputFileTracingRoot: __dirname,
};

// plan.md Phase 5.4 (experimental.optimizePackageImports: ['three',
// '@react-three/fiber']) was also tried and reverted: perf-check.mjs's
// `script` bucket was flat to a rounding error (387.5KB -> 387.8KB, i.e.
// slightly worse) and the two large three.js chunks were unchanged in
// practice (383194 bytes exactly, 359552 -> 361851). This optimizer rewrites
// import statements at the Babel/SWC level for packages with many small
// named exports used sparingly per file (icon sets, lodash-es); it has
// nothing to rewrite here, since the files that import from three/r3f
// already import broadly and the library's real cost is in the
// implementation code those imports pull in, not in how the imports
// themselves are written. Confirms Phase 3.1's own finding (D30) from a
// second angle: this codebase's three.js weight does not come apart via
// import-level tooling, on this webpack/Next setup, at all.

// plan.md Phase 3.1 was tried and reverted, not just skipped -- worth
// recording so it isn't tried again the same way. The theory (alias `three`
// to `three/src/Three.js` so webpack can see inside it and tree-shake the
// animation system, SkinnedMesh/BatchedMesh, the loaders, etc.) is sound and
// is a real, documented pattern for this package. In practice, on this
// Next 15.5 / webpack setup, it did the opposite of what the plan expected:
// the two pre-bundled chunks it was meant to replace (measured 383KB + 359KB
// minified = 742KB raw) became ONE chunk at 772KB raw, and perf-check.mjs's
// own gzip-bucket number for `script` went UP (387.6KB -> 395.6KB wire), not
// down. Read literally, aliasing into three's ESM source defeated Next's own
// automatic chunk-splitting heuristics for that module graph without
// actually eliminating the unused code -- every source file got its own
// webpack module wrapper instead, and nothing shook out. The plan's own
// fallback for this phase ("if the saving is under ~80KB raw, revert it")
// covers this outcome even though it undersold it: this was not a
// disappointing saving, it was a regression.

export default nextConfig;
