# Enterprise UI Redesign — Style Brief

> Read this before touching any UI file. Every page and component must conform.
> The redesign aims for **Linear / Stripe / Bloomberg / late-Apple** levels of
> restraint and confidence — rigorous typography, hairline borders, decisive
> hierarchy, motion in service of meaning. Yellow remains the brand color but
> is wielded as a **deliberate accent**, not as wallpaper.

## Principles (Steve Jobs lens)

1. **Restraint over flair.** No glitch animations, no blur blobs, no rainbow
   gradients, no fake macOS-window mockup chrome (red/yellow/green dots), no
   "sparkle" decorations. Type and content carry the page.
2. **Yellow as accent, not wash.** The brand yellow is a signature spark — the
   primary CTA, the active state, the focus ring, the brand mark, a single
   underline on a hover link. It is **never** a panel background, **never** a
   gradient, **never** more than ~5% of the screen at any moment.
3. **Dignified typography.** Geist Sans throughout. Display: 700 weight, -0.02em
   tracking. Title: 600, -0.01em. Body: 400, 0 tracking. Overline: 600, 0.08em
   tracking, uppercase, 11px. Never use < 12px for actual reading text.
4. **Hairline borders, not chunky.** 1px borders at low chroma. `rounded-md`
   (6px) for inputs and chips, `rounded-lg` (10px) for cards/panels,
   `rounded-xl` (14px) only for hero cards / modals, `rounded-full` for pills
   and avatars. Avoid `rounded-2xl` and above except on marketing hero
   surfaces.
5. **Quiet shadow.** Cards rest flat (border + bg). Raise them only on hover
   (`shadow-xs`). Modals/popovers use a single soft `shadow-lg` with low
   opacity. No glowing drop shadows.
6. **Density that breathes.** 14px body, 13px secondary, 12px caption. Page
   gutters: 24px on mobile, 32–40px on desktop. Section vertical rhythm: 48–80px.
7. **Motion with intention.** 150–200ms standard, 80ms hover, ease-standard
   curve. Never shake, glitch, bounce, or auto-loop. Honor `prefers-reduced-motion`.
8. **One H1, one primary action.** Per page. Per region. Secondary actions
   are `outline` or `ghost`. Tertiary are `link`.
9. **Empty space is design.** Generous padding around page headers, modals,
   empty states. Resist filling silence with chrome.

## Tokens (already wired in `src/app/globals.css`)

Use semantic tokens, **not** raw colors. Tailwind utilities map automatically:

| Use | Class |
|-----|-------|
| Page background | `bg-background` |
| Card / raised surface | `bg-card` |
| Sunken inset (input rest, code) | `bg-muted` |
| Subtle accent surface (hover, active row) | `bg-accent` |
| Primary text | `text-foreground` |
| Secondary text | `text-muted-foreground` |
| Tertiary / placeholder | `text-foreground/50` |
| Hairline border | `border-border` |
| Strong border | `border-border-strong` (custom util) |
| Brand yellow text | `text-brand` (custom util) |
| Brand yellow surface | `bg-brand` (custom util) |
| Status: success / warning / info / danger | `text-success` etc. |
| Focus ring | use `focus-visible:ring-ring` |

The legacy `violet-*` Tailwind utilities are aliased to the brand yellow ramp,
so historic `bg-violet-500` etc. still render yellow — but **prefer
semantic tokens** (`bg-brand`, `text-foreground`) in new code.

## Components — required patterns

### Buttons (`@/components/ui/button`)
- `default` — **brand yellow primary**, flat, near-black text, hairline border
  one shade darker, on hover a tiny inner highlight + 1px lift via `shadow-xs`.
- `secondary` — neutral gray surface, foreground text.
- `outline` — transparent bg, 1px border, neutral foreground.
- `ghost` — transparent, hover surface only.
- `destructive` — red-tinted ghost (not solid red).
- `link` — underline-on-hover.

Drop the old `glass-button` multi-layer effect everywhere. Drop `<GlassButton>`
composite usage. Use `<Button variant="default">` for primaries.

### Cards (`@/components/ui/card`)
Flat, hairline `border-border`, `bg-card`, `rounded-lg`. No outer shadow at
rest. Body `p-5` default, `p-4` for `size="sm"`. Card titles: `text-base`
`font-semibold`. Card descriptions: `text-sm text-muted-foreground`.

### Page header (`@/components/product/page_header`)
Use this on every product page. Eyebrow (overline), H1 (`text-2xl font-semibold
tracking-tight`), description, actions slot on the right. Followed by a
`border-b border-border` hairline. **Do not** invent ad-hoc page titles.

### Inputs / textareas
`bg-card` (light) / `bg-muted/40` (dark), 1px `border-border`, `rounded-md`,
focus ring uses `--ring` (a yellow-tinted ring).

### Empty states
Centered icon (24px, `text-muted-foreground`), title (`text-base font-medium`),
description (`text-sm text-muted-foreground`), one primary CTA. No
illustrations or decoration.

### Lists / tables
Hairline row separators (`divide-y divide-border`), 12–16px row padding,
44px min row height for tappable rows. Cell text 14px / `text-sm`.

### Tabs (`@/components/ui/tabs`)
Underline-style: thin 2px brand-yellow indicator under the active tab,
`text-muted-foreground` for inactive, `text-foreground` for active. Avoid
"pill" tabs except for filter chips.

### Sidebars
`bg-card` (or `bg-background` on dark), nav items use `bg-accent` for active
+ `text-foreground font-medium`, `text-muted-foreground` for rest, `gap-2.5
px-2.5 py-2 rounded-md`. Section overlines `text-[10px] uppercase
tracking-wider font-semibold text-muted-foreground/70`.

## Things to delete or replace

| Anti-pattern | Replacement |
|---|---|
| `<AnimatedBackground>` blob hero | Subtle one-time gradient mask or plain `bg-background` |
| `GlitchTitle` | Static `<h1>`, optional fade-in via `motion` |
| Fake macOS terminal mockups (3 colored dots, monospace fake text) | Real product screenshot or omit |
| `<AnimatedGlowingSearchBar>` | Standard `<Input>` with leading icon |
| `<AnomalyHeatmap>` decorative | Remove from marketing; only keep in admin observability if real |
| `<NotificationCenterFeed>` decorative | Remove decoratively; real feed only |
| `glass-button-*` composites | `<Button>` |
| `bg-violet-XXX` direct usage | `bg-brand`, `text-brand`, or `border-brand` |
| Sparkles / emoji as primary iconography | `lucide-react` icon, 16px, current color |
| `rounded-2xl` / `rounded-3xl` everywhere | `rounded-lg` standard, `rounded-xl` for hero |

## Working agreements for sub-agents

1. **Read the file first**, then `Edit`. Never `Write` over an existing file
   unless full rewrite is justified.
2. Preserve all existing **functionality, props, server logic, data flow,
   imports, exports, and route boundaries**. This is a UI/UX overhaul — not a
   refactor of behavior.
3. Preserve **`'use client'` directives**, async server-component signatures,
   and `searchParams`/`params` plumbing.
4. Use semantic tokens, not hex colors. If you need yellow specifically, use
   the `bg-brand` / `text-brand` utilities or the `--color-violet-500` CSS
   variable; do **not** invent new color values.
5. Run `pnpm tsc --noEmit` if you can; otherwise skim for TS errors.
6. Mark each file you touched in your final summary.
7. Keep diffs tight. Don't touch files outside your assigned slice unless
   strictly necessary; flag cross-cutting concerns in your summary instead.
