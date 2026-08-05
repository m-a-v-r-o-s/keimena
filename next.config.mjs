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

export default nextConfig;
