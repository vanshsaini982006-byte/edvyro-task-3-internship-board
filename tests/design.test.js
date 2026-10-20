'use strict';

// Task 4: automated design checks that need no browser.
//   - WCAG contrast ratios, calculated from the real colour variables in public/styles.css
//   - structure of public/index.html (landmarks, labels, ARIA references, heading order)
//   - rules in public/styles.css that make small screens work (tap size, breakpoints, no wide fixed widths)
// These are STATIC checks. Real layout and rendering are measured in a browser by audit/run.mjs (see docs).

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'styles.css'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const doc = new JSDOM(html).window.document;

// ---------- contrast ----------

const rootBlock = css.match(/:root\s*{([^}]*)}/)[1];
const colours = {};
for (const [, name, value] of rootBlock.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) colours[name] = value;
colours.white = '#ffffff';

function luminance(hex) {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
function ratio(foreground, background) {
  const [a, b] = [luminance(colours[foreground]), luminance(colours[background])].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

describe('Colour contrast (WCAG 2.1 AA)', () => {
  // [text colour, background, where it is used]
  const textPairs = [
    ['ink', 'surface', 'body text on cards and forms'],
    ['ink', 'bg', 'body text on the page'],
    ['muted', 'surface', 'secondary text on cards'],
    ['muted', 'bg', 'summary line'],
    ['muted', 'alt-bg', 'text on the how-it-works band'],
    ['ink', 'alt-bg', 'headings on the how-it-works band'],
    ['accent', 'surface', 'links'],
    ['accent', 'bg', 'links on the page background'],
    ['white', 'accent', 'primary button'],
    ['white', 'accent-dark', 'primary button hover'],
    ['accent-dark', 'white', 'light button in the hero'],
    ['accent-dark', 'hero-muted', 'light button hover'],
    ['hero-ink', 'hero-bg', 'hero heading'],
    ['hero-muted', 'hero-bg', 'hero paragraph and eyebrow'],
    ['ink', 'chip', 'skill chips and button hover'],
    ['muted', 'chip', 'code snippets'],
    ['ink', 'info-bg', 'notices and progress message'],
    ['remote-ink', 'remote-bg', 'Remote pill'],
    ['hybrid-ink', 'hybrid-bg', 'Hybrid pill'],
    ['onsite-ink', 'onsite-bg', 'On-site pill'],
    ['error', 'surface', 'field errors and "No openings"'],
    ['error', 'error-bg', 'form error message'],
    ['error-ink', 'error-bg', 'load error panel'],
    ['success', 'surface', 'confirmation heading'],
    ['success', 'success-bg', 'success message'],
  ];
  for (const [fg, bg, where] of textPairs) {
    test(`${fg} on ${bg} is at least 4.5:1 (${where})`, () => {
      assert.ok(colours[fg] && colours[bg], `missing colour variable for ${fg} or ${bg}`);
      const value = ratio(fg, bg);
      assert.ok(value >= 4.5, `${fg} (${colours[fg]}) on ${bg} (${colours[bg]}) is only ${value.toFixed(2)}:1`);
    });
  }

  // Non-text parts of the interface need 3:1 (WCAG 1.4.11).
  const uiPairs = [
    ['line-strong', 'surface', 'input and button borders'],
    ['focus', 'surface', 'focus ring on white'],
    ['focus', 'bg', 'focus ring on the page background'],
    ['focus', 'alt-bg', 'focus ring on the how-it-works band'],
    ['white', 'hero-bg', 'focus ring and outline button on the hero'],
    ['accent', 'surface', 'spinner'],
    ['error', 'surface', 'invalid-field border'],
  ];
  for (const [fg, bg, where] of uiPairs) {
    test(`${fg} against ${bg} is at least 3:1 (${where})`, () => {
      const value = ratio(fg, bg);
      assert.ok(value >= 3, `${fg} on ${bg} is only ${value.toFixed(2)}:1`);
    });
  }
});

// ---------- HTML structure ----------

describe('Page structure and accessibility markup', () => {
  test('the page declares a language, a viewport and a description', () => {
    assert.equal(doc.documentElement.getAttribute('lang'), 'en');
    assert.match(doc.querySelector('meta[name="viewport"]').content, /width=device-width/);
    assert.ok(!/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/.test(html), 'zoom must not be disabled');
    assert.ok(doc.querySelector('meta[name="description"]').content.length > 50);
    assert.ok(doc.title.length > 10);
  });

  test('landmarks exist: header, labelled navigation, one main, footer, and a skip link that targets real content', () => {
    assert.equal(doc.querySelectorAll('header').length, 1);
    assert.equal(doc.querySelectorAll('main').length, 1);
    assert.equal(doc.querySelectorAll('footer').length, 1);
    assert.ok(doc.querySelector('nav[aria-label]'));
    const skip = doc.querySelector('a.skip-link');
    assert.ok(doc.querySelector(skip.getAttribute('href')), 'skip link target must exist');
    assert.equal(doc.querySelector('.skip-link'), doc.querySelector('body').firstElementChild, 'skip link is the first focusable element');
  });

  test('there is exactly one h1 and headings never skip a level', () => {
    assert.equal(doc.querySelectorAll('h1').length, 1);
    let previous = 0;
    for (const heading of doc.querySelectorAll('h1,h2,h3,h4')) {
      const level = Number(heading.tagName[1]);
      assert.ok(level <= previous + 1, `${heading.id || heading.textContent} jumps from h${previous} to h${level}`);
      previous = level;
    }
  });

  test('every id is unique', () => {
    const ids = [...doc.querySelectorAll('[id]')].map((el) => el.id);
    assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), []);
  });

  test('every aria-controls, aria-describedby, aria-labelledby and label-for reference points at an existing element', () => {
    for (const attribute of ['aria-controls', 'aria-describedby', 'aria-labelledby']) {
      for (const el of doc.querySelectorAll(`[${attribute}]`)) {
        for (const id of el.getAttribute(attribute).split(/\s+/)) assert.ok(doc.getElementById(id), `${attribute}="${id}" has no target`);
      }
    }
    for (const label of doc.querySelectorAll('label[for]')) assert.ok(doc.getElementById(label.getAttribute('for')), `label for ${label.getAttribute('for')}`);
  });

  test('every form control has a visible label', () => {
    for (const control of doc.querySelectorAll('input, select, textarea')) {
      assert.ok(doc.querySelector(`label[for="${control.id}"]`), `#${control.id} has no <label>`);
    }
  });

  test('required fields are marked in markup and in the label text', () => {
    for (const id of ['applicant-name', 'applicant-email', 'resume-url']) {
      assert.equal(doc.getElementById(id).required, true);
      assert.match(doc.querySelector(`label[for="${id}"]`).textContent, /\*/);
    }
  });

  test('the dialog is labelled, and the close control has an accessible name', () => {
    const dialog = doc.getElementById('details-dialog');
    assert.equal(dialog.tagName, 'DIALOG');
    assert.equal(dialog.getAttribute('aria-labelledby'), 'dialog-title');
    assert.match(doc.getElementById('dialog-close').getAttribute('aria-label'), /close/i);
  });

  test('status and error messages sit in live regions', () => {
    assert.equal(doc.getElementById('result-summary').getAttribute('role'), 'status');
    assert.equal(doc.getElementById('state-error').getAttribute('role'), 'alert');
    assert.equal(doc.getElementById('apply-error').getAttribute('role'), 'alert');
    assert.equal(doc.getElementById('apply-progress').getAttribute('role'), 'status');
  });

  test('decorative graphics are hidden from assistive technology', () => {
    for (const svg of doc.querySelectorAll('svg')) assert.equal(svg.getAttribute('aria-hidden'), 'true');
    for (const img of doc.querySelectorAll('img')) assert.ok(img.hasAttribute('alt'));
  });

  test('every button has a type and every button and link has text or an accessible name', () => {
    for (const button of doc.querySelectorAll('button')) {
      assert.ok(button.hasAttribute('type'), `button "${button.textContent.trim()}" needs a type`);
      assert.ok(button.textContent.trim() || button.getAttribute('aria-label'));
    }
    for (const link of doc.querySelectorAll('a')) assert.ok(link.textContent.trim() || link.getAttribute('aria-label'));
  });

  test('scripts are external files and load in the right order', () => {
    const sources = [...doc.querySelectorAll('script')].map((s) => s.getAttribute('src'));
    assert.deepEqual(sources, ['config.js', 'app.js']);
  });
});

// ---------- CSS rules for small screens ----------

describe('Responsive rules in the stylesheet (static checks)', () => {
  test('buttons, inputs and navigation links are at least 44px tall', () => {
    const tap = css.match(/--tap:\s*([\d.]+)rem/);
    assert.ok(tap && Number(tap[1]) >= 2.75, '--tap must be at least 2.75rem (44px)');
    for (const selector of ['input, select, textarea', '.btn', '.site-nav a', '.brand']) {
      const block = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*{([^}]*)}`));
      assert.ok(block, `rule for ${selector} not found`);
      assert.match(block[1], /min-height:\s*var\(--tap\)/, `${selector} must use the tap size`);
    }
  });

  test('there is a tablet breakpoint, and the menu button is only hidden at or above it', () => {
    assert.match(css, /@media \(min-width: 48rem\)/);
    const tablet = css.slice(css.indexOf('@media (min-width: 48rem)'));
    assert.match(tablet, /\.nav-toggle\s*{\s*display:\s*none/);
    const beforeTablet = css.slice(0, css.indexOf('@media (min-width: 48rem)'));
    assert.match(beforeTablet, /\.site-nav\s*{[^}]*display:\s*none/, 'on small screens the menu starts collapsed');
  });

  test('no fixed pixel width wider than the 360px screen is used', () => {
    for (const [, property, value] of css.matchAll(/(?<![-a-z])(width|min-width):\s*([\d.]+)px/g)) {
      assert.ok(Number(value) <= 340, `${property}: ${value}px could cause sideways scrolling at 360px`);
    }
  });

  test('the layout is mobile-first: card grid uses min(100%, ...) so a column can never be wider than the screen', () => {
    assert.match(css, /grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*19rem\),\s*1fr\)\)/);
    assert.match(css, /overflow-wrap:\s*anywhere/);
  });

  test('the dialog fits small screens and scrolls inside itself', () => {
    assert.match(css, /dialog\s*{[^}]*width:\s*min\(40rem,\s*calc\(100% - 1rem\)\)/);
    assert.match(css, /\.dialog-inner\s*{[^}]*overflow-y:\s*auto/);
    assert.match(css, /max-height:\s*calc\(100dvh - 1rem\)/);
  });

  test('motion respects prefers-reduced-motion and focus is never removed without a replacement', () => {
    assert.match(css, /prefers-reduced-motion:\s*reduce/);
    assert.match(css, /:focus-visible\s*{[^}]*outline:\s*3px solid var\(--focus\)/);
    const outlineNone = [...css.matchAll(/([^{}]+){[^}]*outline:\s*none/g)].map((m) => m[1].trim());
    assert.deepEqual(outlineNone, ['.results:focus, #apply-confirmation:focus'], 'outline is removed only from the two programmatic focus targets');
  });
});
