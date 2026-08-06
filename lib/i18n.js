/* Greek only. The site is a Greek publisher's catalogue of a Greek author, and
 * a half-translated one served nobody: most records have no English title, so
 * an EN page showed Greek titles under English chrome.
 *
 * The `[locale]` route segment is GONE with it -- the catalogue is served from
 * `/`. Keeping the segment for one language meant every visitor paid a redirect
 * through `/` to reach `/el/`, which is a longer address bought with an extra
 * round trip and nothing gained. LOCALES stays because the components and the
 * content helpers still switch on a locale, and because it is the honest place
 * to add a second language: that would mean a route group, real English copy,
 * and a decision about `/` -- not a data edit, whatever the old note here
 * claimed. */
export const LOCALES = ['el'];
export const DEFAULT_LOCALE = 'el';

export const DICT = {
  el: {
    siteName: 'Πέτρος Μάρκαρης',
    loading: 'Ανοίγει ο κατάλογος',
    imprint: 'Ο εκδότης',
    titlesLabel: 'Τίτλοι',
    spanLabel: 'Χρονιές',
    authorLabel: 'Συγγραφέας',
    languagesLabel: 'Γλώσσες',
    coverCredit: 'Τα εξώφυλλα ανήκουν στις Εκδόσεις Κείμενα.',
    railLabel: 'Θέση στον κατάλογο',
    authorShort: 'Μάρκαρης',
    buyAt: 'Εκδόσεις Κείμενα',
    buyLabel: 'Αγορά',
    editionLabel: 'Στοιχεία έκδοσης',
    navWorks: 'Έργα',
    navSeries: 'Η σειρά',
    navAuthor: 'Ο συγγραφέας',
    outNow: 'Κυκλοφορεί',
    published: 'Πρώτη έκδοση',
    reissued: 'Επανέκδοση',
    publisher: 'Εκδόσεις',
    pages: 'Σελίδες',
    seriesLabel: 'Αστυνόμος Χαρίτος',
    volume: 'Τόμος',
    epilogue: 'Επίλογος',
    readingOrder: 'Σειρά ανάγνωσης',
    backToShelf: 'Πίσω στα έργα',
    alsoInSeries: 'Στην ίδια τριλογία',
    praiseLabel: 'Κριτικές',
    excerptLabel: 'Απόσπασμα',
    excerptFlipbook: 'Απόσπασμα (flipbook)',
    excerptPdf: 'Απόσπασμα (PDF)',
    interviewsLabel: 'Συνεντεύξεις',
    pressLabel: 'Στον Τύπο',
    newTab: 'ανοίγει σε νέα καρτέλα',
    audioMarker: 'ήχος',
    videoMarker: 'βίντεο',
    pdfMarker: 'PDF',
    languagesLine: (n) => `Μεταφρασμένος σε ${n} γλώσσες`,
    authorTitle: 'Ο συγγραφέας',
    seriesTitle: 'Αστυνόμος Κώστας Χαρίτος',
    worksTitle: 'Τα έργα',
    anniversary: '30 χρόνια Χαρίτος',
    novels: 'μυθιστορήματα',
    stories: 'Διηγήματα',
    footerNote:
      'Καταλογος έργων. Δεν πωλούνται βιβλία από αυτόν τον ιστότοπο.',
    socialLabel: 'Κοινωνικά δίκτυα',
    facebookLabel: 'Facebook',
    instagramLabel: 'Instagram',
    youtubeLabel: 'YouTube',
    testTag: 'TEST BUILD',
    testNotice:
      'Δοκιμαστικό έργο (Akos Digital Services): απαγορεύεται η δημοσίευση χωρίς την έγκριση των Εκδόσεων ΚΕΙΜΕΝΑ.',
  },
};

export function t() {
  return DICT[DEFAULT_LOCALE];
}


