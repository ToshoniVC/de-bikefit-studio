# De Bikefit Studio — design system

Plain HTML + CSS, no build step. `prototype/styles.css` is only an entry point:
it loads the web fonts, then three cascade layers.

```
@layer tokens, base, components;   /* later layers win, specificity-free */
tokens.css      all raw values          (the only file with literals)
base.css        reset, element defaults, .ds-* primitives
components.css  every component rule    (all values via var(--ds-*))
```

> The `@layer` statement sits **after** the `@import`s on purpose: Chrome drops
> any `@import` that follows a `@layer` statement which itself follows an
> `@import`, which silently disables the whole system.

## Source of truth

The brand banner `WhatsApp Image 2026-09-22 at 21.45.35.jpeg`
(sha256 `1e48e4ed415a9eda30b31aff4036f8f13b7716f3469c895f7ec8ef11082d9c0b`,
994×343): burgundy ground, cream condensed-800 wordmark, spaced-caps strapline,
italic tagline, bold URL, and a thick ring cropped off the right edge.

## Palette

| Token (semantic) | Value | Role | Used by |
| --- | --- | --- | --- |
| `--ds-color-surface-inverse` | `#3e1420` | brand ground (sampled) | utility bar, `.section--dark`, `.callout` |
| `--ds-color-surface-inverse-raised` | `#481e28` | raised on burgundy (ring tint, sampled) | `.section--dark .feature` |
| `--ds-color-surface-inverse-raised-hover` | `#56272f` | hover on burgundy | `.section--dark .feature:hover` |
| `--ds-color-surface-footer` | `#2c0e17` | deepest step | `.site-footer` |
| `--ds-color-fg-inverse` | `#edd5b9` | cream, primary on burgundy (sampled) | titles, wordmark, button labels |
| `--ds-color-fg-inverse-soft` | `#e0c7ac` | body copy on burgundy | `.rich--invert`, `.section--dark` |
| `--ds-color-fg-inverse-muted` | `#c19e8b` | rose-tan, secondary (sampled) | utility bar, footer links, `.feature__body` |
| `--ds-color-fg-inverse-subtle` | `#a88372` | tertiary on burgundy (4.6:1) | eyebrows, step numerals on dark |
| `--ds-color-border-inverse-subtle` | `#8c6a5a` | mauve strapline rule (sampled) | eyebrow rule on dark, callout top rule |
| `--ds-color-bg` | `#fdfbf7` | warm page ground | `body`, `.site-header` |
| `--ds-color-surface` | `#f7f1e8` | soft bone surface | `.hero`, `.section--gray`, `.page-head` |
| `--ds-color-surface-alt` | `#efe6d9` | one step darker | alternate bands, light visual gradient |
| `--ds-color-surface-raised` | `#fffdf9` | cards on light | `.feature`, `.audience__card` |
| `--ds-color-border` / `-strong` | `#e8dccc` / `#d8c6af` | rules on light | grids, card outlines, eyebrow rules |
| `--ds-color-fg` | `#2a1219` | burgundy-tinted ink | headings + body on light |
| `--ds-color-fg-muted` | `#5a3f44` | secondary on light | ledes, body copy |
| `--ds-color-fg-subtle` | `#7a6063` | tertiary on light | eyebrows, numerals, `.hero__title em` |
| `--ds-color-accent` / `-hover` | `#3e1420` / `#35111b` | burgundy **is** the accent | buttons, nav underline, rules, bullets |
| `--ds-color-interactive-inverse` | `#edd5b9` | cream control on burgundy | `.btn--dark`, `.btn--ghost-on-dark:hover` |

All body-text pairings clear WCAG AA (cream 11.2:1, rose-tan 6.4:1, mauve-400
4.6:1 on the ground; ink 17:1, muted 9.1:1, subtle 5.5:1 on bone).

## Typography — hierarchy levels

Barlow Condensed (display) + Inter (body). No new font requests.

1. **Wordmark / display** — `--ds-font-weight-wordmark` (800), uppercase,
   `--ds-tracking-display` (-0.01em), `--ds-leading-wordmark`/`-hero`.
   `.hero__title`, `.page-head__title`, `.callout__title`, `.ds-wordmark`.
2. **Bold emphasis** — condensed 600/700 uppercase: `.ds-heading`, buttons,
   nav, footer column headings.
3. **Italic tagline** — `.ds-tagline`: Inter, italic, weight 400, sentence case
   (the reference's "Pijnvrij fietsen begint hier"). Adopted by
   `.rich blockquote`; `.hero__title em` borrows the italic + one tone back.
4. **Strapline / eyebrow** — `.ds-eyebrow`: condensed weight 400, uppercase,
   tracking 0.20–0.22em, 12px, over a hairline rule.
5. **Muted meta** — 12–13px, `--ds-tracking-meta`/`-nav`, subtle colour.

## Spacing & layout

`--ds-space-3xs … 5xl` map onto a px scale (4 → 100). Rhythm: sections
100px block (64px ≤900px), hero 80px (60px ≤900px), page head 96/72, callout
64px. Container `--ds-container-max` 1400px, prose `--ds-container-narrow`
860px, gutter 24px. Measures are `ch`-based (`--ds-measure-*`). Everything is
square: `--ds-radius-control` is 0; the ring is the only circle.

## The ring motif

A thick circular outline, one step lighter than its surface, cropped off the
top-right edge — the reference's only decoration. It is always a
pseudo-element: no markup, no layout impact, invisible to screen readers.
Tokens: `--ds-ring-color-on-dark|on-light`, `--ds-ring-size(-compact)`,
`--ds-ring-thickness(-compact)`, `--ds-ring-offset-inline|-block`.
Applied to `.hero__media`, `.page-head`, `.callout`, `.split__visual`; shrinks
to the compact size ≤900px. For new markup use `.ds-ring` on a block that may
be clipped. It replaced the old diagonal hatch textures.

## Component inventory

| Component | Classes / modifiers |
| --- | --- |
| Utility bar | `.utility-bar`, `__inner` |
| Header / nav | `.site-header`, `.nav`, `__logo`, `__menu` (`a.active`), `__cta` |
| Buttons | `.btn` + `--primary`, `--outline`, `--ghost`, `--ghost-on-dark`, `--dark`; `.btn__arrow` |
| Hero | `.hero`, `__media` (ring), `__content`, `__eyebrow`, `__title` (`em`), `__sub`, `__actions` |
| Section | `.section` + `--dark`, `--gray`; `__inner`, `__eyebrow`, `__title`, `__lede` |
| Feature grid | `.feature-grid`, `.feature`, `__num`, `__title`, `__body` |
| Split | `.split` + `--reverse`; `.split__visual` + `--alt` (ring) |
| Callout | `.callout` (ring), `__inner`, `__title` |
| Steps | `.steps`, `.step`, `__num`, `__title`, `__body` |
| Audience | `.audience`, `.audience__card` |
| FAQ | `.faq`, `__item`, `__q`, `__a` |
| Footer | `.site-footer`, `.footer__grid`, `__col`, `__brand`, `__bottom` |
| Page head | `.page-head` (ring), `__inner`, `__crumb`, `__title`, `__lede` |
| Rich text | `.rich` + `--invert` (h2/h3/p/ul/blockquote) |
| Primitives | `.ds-container`, `.ds-eyebrow`, `.ds-display`, `.ds-heading`, `.ds-lede`, `.ds-tagline`, `.ds-wordmark`, `.ds-ring`, `.ds-stack-lg` |

`logo.svg` is dark ink on light, so it stays in the header only. The burgundy
footer uses the CSS wordmark `.ds-wordmark` with the same text as the image's
`alt`, so nothing is lost for assistive tech. The SVG itself is unmodified.

## Rules

- **Tiering.** `tokens.css` holds every literal. `base.css` and
  `components.css` reference semantic tokens (`--ds-color-*`, `--ds-space-*`,
  `--ds-text-*`), or a primitive `--ds-scale-*` / `--ds-width-*` for a genuine
  one-off. Check with:
  `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(" base.css components.css ../styles.css`
  — it must print nothing.
- **Adding a token.** Add the raw value to the primitive tier, then point a
  semantic token at it. Never reference a primitive colour from a component.
- **Adding a component.** Append a block to `components.css` with a comment
  naming its surface, reuse the `.ds-*` primitives in the markup, and add it to
  the table above. If two components end up sharing a declaration block, promote
  it to a `base.css` primitive instead.
- **Changing the brand.** Recolouring the site is a single edit to the burgundy
  / cream / bone primitives; nothing downstream needs to change.
