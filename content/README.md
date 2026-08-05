# Content layer

The shelf, series, book and author pages are **generated from these files**. Do not hand-code
a book anywhere in the UI.

- `author.json` — bio, timeline, awards, the "30 years of Charitos" hook.
- `books.json` — 27 works: 18 Charitos novels (`series_order` 1–18, no gaps), 2 Charitos
  story collections, 7 other works (play, essays, non-fiction, the Goethe translation).

Deviation from PLAN.md §5: one `books.json` array instead of `content/books/*.json`. Same
contract — data-driven shelf — with 27 fewer files to keep in sync. Split later if per-book
MDX bodies are wanted.

## Rules the data enforces

**`year` is first publication, never the reissue.** Keimena's author page shows current-edition
years — it lists *Νυχτερινό δελτίο* as 2024, but that novel is from 1995. Reissues live in
`reissue_year`. **The shelf sorts on `year`.** Getting this wrong collapses the 30-year arc
into a 5-year one, which is the whole editorial premise.

**`synopsis_status` gates display.** `publisher` = sourced, safe to render. `needs_copy` = not
yet sourced; render the card *without* a synopsis. Do not write one from memory — the handoff's
definition of done forbids fabricated bibliography copy.

**`praise` needs a named person and outlet.** Empty array is the honest default.

## Open content work

25 of 27 titles are `needs_copy`. Verified synopses exist only for *Όλα για την ανάπτυξη*
(2026) and *Η βία της αποτυχίας* (2024). One verified praise quote exists in total:
Brian Oliver, The Observer — "one of the ten best contemporary crime writers in Europe",
carried on the Greek edition, so it is usable site-wide rather than on that title alone.

To finish: pull blurbs from each title's keimenabooks.gr product page (or the printed jackets),
and collect German/Italian/Spanish review quotes with attribution — that reception is real and
well documented, it just is not in the sources reached during the content pass.

The design must therefore look right with a sparse dataset: **a book with no synopsis and no
praise still has to render as a finished object**, because today most of them are.

## Corrections carried from planning

- The 2024 novel is **«Η βία της αποτυχίας»**, not «Βία» — the publisher listing truncated it.
  Verified: bookpress.gr, protoporia.gr, ISBN 9786185642280.
- **Languages: 20**, per Keimena's current author page. Older jackets and the Onassis Foundation
  bio say 14 — that bio lists titles only through 2010. Print one figure, not both.
