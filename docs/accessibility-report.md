# Accessibility report

Target: WCAG 2.1 level AA (with a few WCAG 2.2 checks from axe-core).
Every result below is labelled by how it was obtained:

- **Automated, in `npm test`** (jsdom, no browser): repeatable on any computer.
- **Automated, real browser** (`audit/run.mjs`: headless Chromium 153, axe-core 4.14.0, Lighthouse 13.5.0, keyboard simulation). Raw output: `docs/evidence/audit-results.json`; screenshots: `docs/evidence/screenshots/`.
- **Manual / not done:** things only a human with real assistive technology can confirm. These are **not** claimed as passed.

This report is a self-assessment and not a formal accessibility audit or a conformance claim.

## 1. Automated checks in `npm test` (`tests/design.test.js`, `tests/frontend.test.js`)

| Check | Result |
|-------|--------|
| Page has `lang`, viewport (zoom not disabled), title and description | Pass |
| Landmarks: one `header`, one `main`, one `footer`, a labelled `nav`; skip link is first and its target exists | Pass |
| One `h1`; heading levels never skip | Pass |
| Unique IDs; every `aria-controls`, `aria-describedby`, `aria-labelledby` and `label for` points at a real element | Pass |
| Every input, select and textarea has a visible `<label>`; required fields marked in markup and text | Pass |
| Dialog is a native `<dialog>` with `aria-labelledby`; close button has an accessible name | Pass |
| Live regions: results summary and progress use `role="status"`; load and form errors use `role="alert"` | Pass |
| Decorative SVG is `aria-hidden`; every button has a `type` and a name | Pass |
| Mobile menu: `aria-expanded` and `aria-controls` update, Esc closes it, focus returns to the menu button | Pass |
| Form: errors appear next to fields, field gets `aria-invalid`, focus moves to the first invalid field | Pass |
| Dialog: focus returns to the button that opened it; confirmation panel receives focus and is a labelled `group` | Pass |
| Errors and success are not shown by colour alone: messages start with the words "Error:" / "Success:", mode is a text pill | Pass |
| Page-scroll lock while the dialog is open is applied and removed | Pass |
| `prefers-reduced-motion` respected; focus outline is removed only from the two programmatic focus targets | Pass |

### Colour contrast (calculated from the real colours in `styles.css`)

Text needs 4.5:1; borders, focus rings and other interface parts need 3:1. The test checks 25 text pairs and 7 interface pairs. Selected values:

| Pair | Ratio | Needs |
|------|-------|-------|
| Body text on cards | 16.75 : 1 | 4.5 |
| Secondary (muted) text on cards | 8.22 : 1 | 4.5 |
| Links / white on primary button | 7.83 : 1 | 4.5 |
| Hero heading and paragraph text on the dark green | 11.85 : 1 and 9.27 : 1 | 4.5 |
| Work-mode pills (Remote / Hybrid / On-site) | 8.65, 8.55, 7.52 : 1 | 4.5 |
| Error text on white / on error background | 7.52 and 6.55 : 1 | 4.5 |
| Focus ring on white | 8.33 : 1 | 3 |
| Input border on white | 4.45 : 1 | 3 |

Limit: these are calculated for the declared colours. They do not cover text on the dim backdrop behind the dialog (see axe "needs review" below), anti-aliasing, or user colour overrides.

## 2. Real-browser checks (headless Chromium 153)

### axe-core 4.14.0 (rules: WCAG 2.0/2.1/2.2 A and AA plus best-practice)

| Page state | Viewport | Violations | Rules passed | Needs review |
|------------|----------|-----------|--------------|--------------|
| Home page | 360 px | 0 | 45 | 0 |
| Home page | 1280 px | 0 | 45 | 0 |
| Details dialog open | 360 px | 0 | 29 | colour-contrast on 1 element |
| Details dialog open | 1280 px | 0 | 29 | 0 |
| Dialog with validation errors | 360 px | 0 | 32 | colour-contrast on 12 elements |
| Dialog with validation errors | 1280 px | 0 | 32 | colour-contrast on 10 elements |

"Needs review" means axe could not decide automatically (it cannot compute contrast for text sitting over the semi-transparent dialog backdrop and some error text). It is **not** a pass and **not** a failure. The same colours are verified by calculation above and appear correctly in the screenshots, but a human should look at them (checklist below).

### Lighthouse accessibility category

The accessibility score was **100** in every Lighthouse run recorded for the Task 4 build (mobile and desktop). See `docs/performance-report.md` for the run-by-run table. Lighthouse covers only the automatically testable subset of WCAG.

### Keyboard behaviour (scripted key presses in Chromium, 1280 px)

| Check | Result |
|-------|--------|
| First 16 Tab stops follow reading order: skip link, brand, 3 nav links, 2 hero buttons, search, domain, mode, Search, Clear, then the card buttons | As expected |
| Every one of those stops shows a visible focus ring (3 px solid outline) | Yes, 16 of 16 |
| Enter on a "View details" button opens the dialog and moves focus inside it | Yes |
| 24 Tab presses inside the open dialog: focus never reached the page behind it | Yes. 3 of the 24 presses moved to the browser's own controls, which is normal for a native modal dialog |
| Submitting the empty form with Enter: focus goes to the first invalid field; it gets `aria-invalid="true"` and the message "Enter your full name." | Yes |
| Esc closes the dialog and focus returns to the button that opened it | Yes |
| Typing in the search box (keyboard only) updates the results ("Showing 1–2 of 2 internships") | Yes |

> Note on honesty: my first version of the dialog focus check reported a failure. The check was too strict: it treated focus moving to the browser's address bar as "escaping". I corrected the check to test the real requirement (focus must not reach the hidden page) and re-ran it. Both runs are consistent with the code; only the check changed.

### Responsive and touch targets (measured in the browser)

| Width | Sideways scroll | Cards per row | Menu | Controls under 44 px |
|-------|-----------------|---------------|------|----------------------|
| 320 px (WCAG reflow width) | None (document width 320) | 1 | Collapsed behind a Menu button | None |
| 360 px | None (document width 360) | 1 | Collapsed behind a Menu button | None |
| 375 px | None | 1 | Collapsed | None |
| 768 px | None | 2 | Inline links | None |
| 1280 px | None | 3 | Inline links | None |

At 320, 360, 375 and 768 px the details dialog stayed inside the screen (8 px margin at phone widths), never scrolled sideways, scrolled inside itself when taller than the screen, and locked page scrolling behind it. The smallest text on the page is 13.6 px (hint and field-error text).

## 3. What was NOT tested (do these yourself)

None of these has been done, so none is claimed:

- [ ] **Screen reader**: NVDA (free, Windows) with Chrome or Firefox. Check the page title, landmarks, the cards, that the result count is announced after searching, that errors are announced when you submit an invalid form, and that "Application received" is announced after a successful submit.
- [ ] **VoiceOver** on iPhone/Mac, and **TalkBack** on Android, if available.
- [ ] **Real phones**: open the live site on at least one real phone; try the menu, the dialog and the keyboard.
- [ ] **Zoom to 200% and 400%** (Ctrl and +): content should reflow with no sideways scrolling and nothing cut off. (Widths 360 px and 375 px above approximate 400% on a laptop, but this was not tested by actual zoom.)
- [ ] **Windows High Contrast / forced colours** mode.
- [ ] **Text spacing** overrides (WCAG 1.4.12) and large browser default font size.
- [ ] **Human check of colour contrast** on the dialog backdrop and error messages (the axe "needs review" items).
- [ ] **Voice control** and **switch** access.

## 4. Known issues

- On screen readers, `role="status"` messages inside a freshly shown part of the page are sometimes not announced the first time. The confirmation panel is therefore also given focus and a group name so that it is read out; this has not been confirmed with a real screen reader.
- The dialog uses the browser's native `<dialog>`; behaviour is good in current Chrome, Edge, Firefox and Safari, but older browsers (before 2022) may not support it.
