'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { t as dict } from '@/lib/i18n';
import { CONSENT_KEY } from '@/lib/site';

/**
 * A minimal consent banner, shown once until the reader picks either option.
 *
 * Starts unrendered on both the server and the first client render (there is
 * no reader to ask yet, and localStorage doesn't exist on the server) --
 * same "decide after mount" shape AuthorPoster.jsx uses for its own
 * prefers-reduced-motion check, for the same reason: it avoids a hydration
 * mismatch rather than papering over one.
 *
 * Analytics.jsx reads the same CONSENT_KEY and listens for this component's
 * 'consentchange' event, so accepting here can turn analytics on immediately
 * without a reload.
 */
export default function CookieConsent() {
  const s = dict();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem(CONSENT_KEY)) setVisible(true);
  }, []);

  const decide = (value) => {
    localStorage.setItem(CONSENT_KEY, value);
    window.dispatchEvent(new CustomEvent('consentchange', { detail: value }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    // role="region", not "dialog": nothing here traps focus or blocks the
    // rest of the page, so "dialog" would overclaim -- "region" is the
    // accurate ARIA role and, unlike "dialog", a real landmark (see
    // landmarks/region), so this panel counts as content a screen reader
    // can navigate to rather than content floating outside every landmark.
    <div className="cookieBanner" role="region" aria-live="polite" aria-label={s.cookieHeading}>
      <p>
        {s.cookieMessage}{' '}
        <Link href="/privacy/">{s.cookieLearnMore}</Link>
      </p>
      <div className="cookieBanner__actions">
        <button type="button" className="cookieBanner__decline" onClick={() => decide('denied')}>
          {s.cookieDecline}
        </button>
        <button type="button" className="cookieBanner__accept" onClick={() => decide('granted')}>
          {s.cookieAccept}
        </button>
      </div>
    </div>
  );
}
