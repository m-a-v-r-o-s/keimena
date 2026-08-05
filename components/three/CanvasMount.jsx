'use client';

import dynamic from 'next/dynamic';

/**
 * Client boundary for the canvas.
 *
 * `ssr: false` is only legal inside a Client Component, and the canvas genuinely
 * cannot be server-rendered: it measures DOM boxes that do not exist until the
 * page has laid out. Keeping the boundary in its own file means the whole three
 * bundle stays out of the server graph and out of the static export.
 */
const BookCanvas = dynamic(() => import('./BookCanvas'), { ssr: false });

export default function CanvasMount() {
  return <BookCanvas />;
}
