import Nav from '@/components/Nav';
import Footer from '@/components/Footer';
import { DEFAULT_LOCALE, t as dict } from '@/lib/i18n';
import { shelfOrder, catalogueYears } from '@/lib/content';
import { SITE_URL } from '@/lib/site';

export function generateMetadata() {
  const title = 'Πολιτική Απορρήτου';
  const description = 'Πολιτική απορρήτου του καταλόγου έργων του Πέτρου Μάρκαρη: τι δεδομένα συλλέγονται και πώς χρησιμοποιούνται τα cookies.';
  return {
    title,
    description,
    alternates: { canonical: '/privacy/' },
    openGraph: { title, description, type: 'website', url: `${SITE_URL}/privacy/` },
  };
}

/**
 * A genuine draft, not boilerplate copied from a generator -- it describes
 * what this codebase actually does (no accounts, no forms, no server; an
 * optional, consent-gated GA4 scaffold that ships with no id set, see
 * components/Analytics.jsx). It is still marked as needing real legal review
 * before this site is a live, public property: that disclaimer is load-
 * bearing, not decoration.
 */
export default function PrivacyPage() {
  const locale = DEFAULT_LOCALE;
  const s = dict(locale);
  const books = shelfOrder();
  const { oldest, newest } = catalogueYears(books);

  return (
    <>
      <Nav />
      <main id="main">
        <section className="wrap section legal">
          <p className="meta detail__eyebrow">{s.privacyLabel}</p>
          <h1 className="intro__title">Πολιτική Απορρήτου</h1>

          <p className="legal__notice">
            Πρότυπο κείμενο. Αυτή η σελίδα περιγράφει με ακρίβεια τι κάνει σήμερα ο κώδικας
            αυτού του ιστότοπου, αλλά δεν αποτελεί νομική συμβουλή και χρειάζεται έλεγχο από
            δικηγόρο πριν ο ιστότοπος γίνει δημόσιος, ειδικά αν προστεθούν φόρμες, λογαριασμοί
            χρηστών ή πραγματική συλλογή δεδομένων.
          </p>

          <h2>Σχετικά με αυτόν τον ιστότοπο</h2>
          <p>
            Αυτός ο ιστότοπος είναι ένας κατάλογος των έργων του Πέτρου Μάρκαρη. Είναι ένα
            δοκιμαστικό/επίδειξη έργο (βλ. σημείωση στο υποσέλιδο) και δεν αποτελεί επίσημο
            ιστότοπο των Εκδόσεων ΚΕΙΜΕΝΑ. Δεν πωλούνται βιβλία από αυτόν τον ιστότοπο· κάθε
            σύνδεσμος αγοράς οδηγεί στην ιστοσελίδα του εκδότη ή σε τρίτο κατάστημα.
          </p>

          <h2>Δεδομένα που συλλέγουμε</h2>
          <p>
            Ο ιστότοπος δεν έχει λογαριασμούς χρηστών, φόρμες επικοινωνίας ή εξυπηρετητή που
            αποθηκεύει δεδομένα: είναι στατικά αρχεία, χωρίς βάση δεδομένων. Δεν συλλέγονται
            ονόματα, διευθύνσεις email ή άλλα προσωπικά στοιχεία σε καμία σελίδα.
          </p>

          <h2>Cookies και τοπική αποθήκευση</h2>
          <p>Ο ιστότοπος χρησιμοποιεί δύο πράγματα στη συσκευή σας:</p>
          <ul>
            <li>
              Μία τιμή σε τοπική αποθήκευση (local storage, όχι cookie) που θυμάται αν έχετε
              αποδεχτεί ή απορρίψει τα προαιρετικά στατιστικά επισκεψιμότητας. Είναι απαραίτητη
              για να μη σας ρωτάει ξανά το ίδιο σε κάθε σελίδα.
            </li>
            <li>
              Αν αποδεχτείτε, ανώνυμα στατιστικά επισκεψιμότητας (Google Analytics). Αυτά είναι
              ανενεργά από προεπιλογή σε αυτή την έκδοση του ιστότοπου και ενεργοποιούνται μόνο
              αφού συνδεθεί πραγματικό αναγνωριστικό μέτρησης από τον διαχειριστή του ιστότοπου
              και μόνο εφόσον έχετε πατήσει «{s.cookieAccept}» στο μήνυμα cookies.
            </li>
          </ul>
          <p>Μπορείτε να αλλάξετε γνώμη διαγράφοντας τα δεδομένα ιστότοπου του browser σας για αυτή τη σελίδα.</p>

          <h2>Περιεχόμενο και πνευματικά δικαιώματα</h2>
          <p>
            Τα εξώφυλλα, τα αποσπάσματα και το βιογραφικό υλικό ανήκουν στις Εκδόσεις ΚΕΙΜΕΝΑ και
            στον Πέτρο Μάρκαρη· εμφανίζονται εδώ με άδεια για τους σκοπούς αυτού του καταλόγου.
            Αυτή η πολιτική απορρήτου αφορά μόνο τη λειτουργία του ίδιου του ιστότοπου, όχι τις
            πρακτικές απορρήτου του εκδότη στον δικό του ιστότοπο.
          </p>

          <h2>Εξωτερικοί σύνδεσμοι</h2>
          <p>
            Οι σύνδεσμοι αγοράς, τα κοινωνικά δίκτυα και οι σύνδεσμοι Τύπου οδηγούν σε ιστότοπους
            τρίτων που δεν ελέγχονται από αυτόν τον κατάλογο και έχουν τη δική τους πολιτική
            απορρήτου.
          </p>

          <h2>Επικοινωνία</h2>
          <p>[ΣΤΟΙΧΕΙΑ ΕΠΙΚΟΙΝΩΝΙΑΣ ΝΑ ΣΥΜΠΛΗΡΩΘΟΥΝ ΠΡΙΝ ΤΗ ΔΗΜΟΣΙΕΥΣΗ]</p>
        </section>
      </main>
      <Footer locale={locale} count={books.length} from={oldest} to={newest} />
    </>
  );
}
