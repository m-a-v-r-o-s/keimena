'use client';

import { useEffect, useState } from 'react';
import Script from 'next/script';
import { CONSENT_KEY } from '@/lib/site';

/**
 * GA4 scaffold, off by default.
 *
 * NEXT_PUBLIC_GA_ID is unset in this repo (see .env.local, gitignored) --
 * with no id there is nothing to load, so a fresh checkout tracks no one.
 * Wiring a real measurement id in later is a one-line env var, not a code
 * change.
 *
 * Gated on CookieConsent.jsx's own decision, read from the same CONSENT_KEY:
 * the script tag only renders once localStorage already says 'granted',
 * checked after mount (no consent record exists to read on the server) and
 * re-checked on the 'consentchange' event so accepting the banner turns this
 * on live, without a reload.
 */
export default function Analytics() {
  const gaId = process.env.NEXT_PUBLIC_GA_ID;
  const [granted, setGranted] = useState(false);

  useEffect(() => {
    setGranted(localStorage.getItem(CONSENT_KEY) === 'granted');
    const onChange = (e) => setGranted(e.detail === 'granted');
    window.addEventListener('consentchange', onChange);
    return () => window.removeEventListener('consentchange', onChange);
  }, []);

  if (!gaId || !granted) return null;

  return (
    <>
      <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`} strategy="afterInteractive" />
      <Script id="ga-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');`}
      </Script>
    </>
  );
}
