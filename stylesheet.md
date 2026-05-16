# Poggle Design System — Quiet Power

> **Design philosophy:** Quiet confidence. Less ornament, more clarity. The UI should recede so the user's work can advance. Think Linear × Stripe × early Apple.

---

## 1. Stack & Libraries

| Layer | Library | Notes |
|-------|---------|-------|
| Framework | Next.js App Router | Server + client components, server actions |
| Styling | Tailwind CSS v4 | `@tailwindcss/postcss`, no config file — all in CSS |
| Components | shadcn/ui + Base UI | Headless primitives via `@base-ui/react` |
| Icons | `lucide-react` + `hugeicons-react` | Standard sizes: 3, 3.5, 4, 5 (w/h in Tailwind units) |
| Fonts | Geist Sans + Geist Mono | OpenType features: `cv11`, `ss01`, `ss02` |
| Animation | `motion/react` (Motion v12) | `LazyMotion + domAnimation` bundle, `MotionConfig reducedMotion="user"` |
| Theme | `next-themes` | Attribute-based dark mode class |
| Class merging | `clsx + tailwind-merge` via `cn()` | `src/lib/utils.ts` |

### Key architectural rules
- `"use client"` only when strictly needed (state, events, browser APIs, motion)
- Server components fetch data; client components own interactivity
- Base UI does **not** support `asChild` — use `render=` prop pattern instead
- All animation variants live in `src/lib/motion.ts`; never define ad-hoc variants inline

---

## 2. Typography

**Font:** Geist Sans (sans), Geist Mono (mono)  
**Base tracking:** `-0.005em` on body; `-0.018em` on headings (tighter = more premium)

### Scale

| Class | Size | Weight | Line Height | Tracking | Use |
|-------|------|--------|-------------|---------|-----|
| `.text-display` | 40px | 600 | 1.10 | -0.024em | Hero headlines |
| `.text-headline` | 26px | 600 | 1.25 | -0.020em | Section titles |
| `.text-title` | 18px | 600 | 1.40 | -0.014em | Panel headers, modal titles |
| `.text-body-lg` | 16px | 400 | 1.55 | — | Long-form, feature descriptions |
| `.text-body` | 14px | 400 | 1.55 | — | Default UI text |
| `.text-caption` | 12px | 400 | 1.50 | — | Timestamps, metadata, labels |
| `.text-overline` | 11px | 600 | 1.50 | +0.08em | Section group headers (all caps) |

### Color roles

| Token | Use |
|-------|-----|
| `text-foreground` | Primary body text |
| `text-muted-foreground` | Secondary, helper text |
| `.text-secondary-label` | Tertiary labels (40% lightness) |
| `.text-tertiary-label` | Quaternary metadata (56% lightness) |
| `text-iris` | Links, AI surfaces, brand moments |

### Conventions
- Heading elements (`h1–h3`) and display utilities inherit `-0.018em` tracking globally via base styles
- Monospace: `.text-mono` applies `--font-mono` with `ss01` + `ss02` OpenType features
- **Never use `font-bold` (700) for UI chrome** — reserve bold weight for truly rare emphasis

---

## 3. Color System

### Philosophy
Enterprise palettes are primarily neutral. Color is deployed surgically: one brand accent for interactive/AI surfaces, semantic colors for status only, everything else is a shade of gray.

### Brand accent — Iris indigo
All Tailwind `violet-*` utilities are remapped to the Iris ramp (centered on `oklch(0.50 0.17 265)`). This gives a restrained, professional indigo used for:
- Focus rings
- Interactive state hints (hover, active)
- AI/Atlas sparkle moments
- Links

| Token | Value | Use |
|-------|-------|-----|
| `--iris` (light) | `oklch(0.50 0.17 265)` | Iris indigo accent |
| `--iris` (dark) | `oklch(0.62 0.18 265)` | Brighter for dark mode legibility |
| `--ring` | Same as `--iris` | Focus rings application-wide |
| `text-iris` / `bg-iris` | Utility classes | Direct iris usage |

### Iris ramp (violet-* overrides)

| Step | Value | Notes |
|------|-------|-------|
| 50 | `oklch(0.97 0.020 265)` | Subtlest background tint |
| 200 | `oklch(0.88 0.075 265)` | Hover background on white |
| 400 | `oklch(0.68 0.150 265)` | Disabled/placeholder accent |
| 500 | `oklch(0.58 0.165 265)` | Mid-weight usage |
| 600 | `oklch(0.50 0.170 265)` | **Signature stop** — buttons, links |
| 800 | `oklch(0.34 0.130 265)` | Dark text on light iris backgrounds |
| 950 | `oklch(0.18 0.070 265)` | Deepest, near-navy |

### Light mode tokens

| Token | Value | Semantic |
|-------|-------|---------|
| `--background` | `oklch(1 0 0)` | Canvas (pure white) |
| `--foreground` | `oklch(0.145 0 0)` | Near-black text |
| `--card` | `oklch(1 0 0)` | Card surface |
| `--primary` | `oklch(0.145 0 0)` | Primary button fill |
| `--primary-foreground` | `oklch(0.99 0 0)` | Primary button text |
| `--secondary` | `oklch(0.97 0 0)` | Secondary button fill |
| `--muted` | `oklch(0.975 0 0)` | Muted background |
| `--muted-foreground` | `oklch(0.50 0 0)` | Muted text |
| `--border` | `oklch(0.93 0.002 264)` | Default border (faint cool drift) |
| `--ring` | `oklch(0.50 0.17 265)` | Iris focus |
| `--sidebar` | `oklch(0.985 0.001 264)` | Sunken from canvas |

### Dark mode tokens

| Token | Value | Semantic |
|-------|-------|---------|
| `--background` | `oklch(0.115 0 0)` | Deep graphite canvas |
| `--foreground` | `oklch(0.96 0 0)` | Near-white text |
| `--card` | `oklch(0.155 0 0)` | Raised card surface |
| `--primary` | `oklch(0.96 0 0)` | White solid primary |
| `--primary-foreground` | `oklch(0.145 0 0)` | Dark text on white button |
| `--border` | `oklch(1 0 0 / 8%)` | Translucent white border |
| `--sidebar` | `oklch(0.135 0 0)` | Slightly lighter than bg |

### Status colors

| Role | Light | Dark | Use |
|------|-------|------|-----|
| Success | `oklch(0.62 0.17 145)` | `oklch(0.72 0.18 145)` | Green confirmations |
| Warning | `oklch(0.70 0.17 60)` | `oklch(0.78 0.17 60)` | Amber warnings |
| Info | `oklch(0.55 0.16 250)` | `oklch(0.68 0.17 250)` | Blue informational |
| Destructive | `oklch(0.58 0.235 27.3)` | `oklch(0.66 0.22 22.2)` | Red errors/delete |

### Surface stack (elevation)

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `surface-sunken` | `oklch(0.975 ...)` | `oklch(0.095)` | Input backgrounds, code blocks |
| `surface-base` | `oklch(1)` | `oklch(0.115)` | Canvas |
| `surface-raised` | `oklch(1)` | `oklch(0.155)` | Cards, panels |
| `surface-overlay` | `oklch(1)` | `oklch(0.185)` | Popovers, dropdowns |

---

## 4. Spacing Scale

4px base grid. All spacing is a multiple of 4px (0.25rem). Do not use arbitrary values.

| Token | rem | px | Tailwind |
|-------|-----|----|---------|
| `--spacing-px` | — | 1px | `px` |
| `--spacing-1` | 0.25rem | 4px | `p-1`, `m-1` |
| `--spacing-2` | 0.5rem | 8px | `p-2`, `m-2` |
| `--spacing-3` | 0.75rem | 12px | `p-3`, `gap-3` |
| `--spacing-4` | 1rem | 16px | `p-4`, `gap-4` |
| `--spacing-6` | 1.5rem | 24px | `p-6`, `gap-6` |
| `--spacing-8` | 2rem | 32px | `p-8` |
| `--spacing-12` | 3rem | 48px | `py-12` |
| `--spacing-16` | 4rem | 64px | `py-16` |
| `--spacing-24` | 6rem | 96px | `py-24` |

### Layout dimensions

| Dimension | Value | Class |
|-----------|-------|-------|
| Sidebar width | 14rem (224px) | `w-56` |
| Topbar height | 3rem (48px) | `h-12` |
| Panel narrow | 18rem (288px) | — |
| Panel medium | 22rem (352px) | — |
| Page max | 1280px | `.page-container` |
| Content max | 1024px | `.page-content` |
| Narrow max | 672px | `.page-narrow` |

---

## 5. Border & Radius

### Radius scale

| Token | Value | Use |
|-------|-------|-----|
| `--radius-xs` | 4px | Tight chip, inline badge |
| `--radius-sm` | 6px | Input, small button |
| `--radius-md` | 8px | Card, panel, dropdown, **default button** |
| `--radius-lg` | 10px | Modal, sheet |
| `--radius-xl` | 14px | Large card |
| `--radius-2xl` | 20px | Hero section |
| `--radius-full` | 9999px | Avatar, pill badge only |

### Usage rules
- **Buttons:** `rounded-md` (8px) — enterprise grade, not pill
- **Cards:** `rounded-lg` (10px)
- **Inputs:** `rounded-md` (8px)
- **Dropdown menus / popovers:** `rounded-md` (8px)
- **Modals / sheets:** `rounded-lg` (10px)
- **Avatars:** `rounded-full`
- **Badges/chips (inline):** `rounded-full` only for count badges; `rounded-sm` (4px) for status badges

### Border tokens

| Token | Light | Dark |
|-------|-------|------|
| `--border-subtle` | `oklch(0.95 ...)` | `oklch(1 0 0 / 5%)` |
| `--border-default` | `oklch(0.92 ...)` | `oklch(1 0 0 / 8%)` |
| `--border-strong` | `oklch(0.78)` | `oklch(1 0 0 / 18%)` |

---

## 6. Shadows

Shadows communicate elevation, not decoration. They are subtle by default.

| Token | Value | Use |
|-------|-------|-----|
| `--shadow-xs` | 1px spread, 4% opacity | Row hover, inline badge |
| `--shadow-sm` | 2px spread, 5% opacity | Input focus halo, button |
| `--shadow-md` | 8px spread, 6% opacity | Card hover, tooltip |
| `--shadow-lg` | 20px spread, 8% opacity | Dropdown, popover |
| `--shadow-xl` | 40px spread, 10% opacity | Modal, sheet, command palette |
| `--shadow-ring` | 0 0 0 1px `--border-default` | Raised card chrome (no drop shadow) |
| `--shadow-ring-strong` | 0 0 0 1px `--border-strong` | Focused input ring chrome |

### Philosophy
Prefer **ring (1px border via box-shadow)** over drop shadows for cards and panels. Use drop shadows only for floating elements (popovers, dropdowns, modals).

---

## 7. Components

### Button

Variants: `default`, `secondary`, `outline`, `ghost`, `destructive`, `link`

| Variant | Background | Border | Use |
|---------|-----------|--------|-----|
| `default` | `bg-primary` (near-black / white) | `border-primary` | One per surface — primary CTA |
| `secondary` | `bg-card` | `border-border` | Everyday secondary actions |
| `outline` | transparent | `border-border` | Tertiary, lower-emphasis |
| `ghost` | transparent | transparent | Toolbar icons, nav items |
| `destructive` | `bg-destructive/10` | `border-destructive/20` | Irreversible actions |
| `link` | transparent | transparent | Inline text links |

Sizes: `xs` (h-6), `sm` (h-8), `default` (h-9), `lg` (h-10), `icon` (h-8 w-8)

**Rules:**
- `rounded-md` on all button variants — no rounded-full pill buttons in app chrome
- Focus: `ring-2 ring-ring ring-offset-2`
- Active: `translate-y-px` (1px press feedback)
- Disabled: `opacity-50 pointer-events-none`

### Card

Structure: `Card > CardHeader > CardTitle + CardDescription + CardAction > CardContent > CardFooter`

- `rounded-lg` container
- `border border-border` + `bg-card`
- Transition on `border-color` and `box-shadow` (150ms) for hover feedback
- Footer: `border-t border-subtle bg-muted/40`

### Input

- `h-9 rounded-md border-input`
- Hover: `border-strong`
- Focus: `border-ring ring-2 ring-ring/30`
- Error: `aria-invalid` → `border-destructive ring-destructive/30`

### Badge

| Variant | Use |
|---------|-----|
| `default` | Primary solid |
| `outline` | Subtle bordered |
| `success` | Green status |
| `warning` | Amber status |
| `error` | Red error |
| `info` | Blue info |
| `secondary` | Neutral |

### Tabs

Variants: `default` (filled, bg-muted list), `line` (transparent with underline indicator)

Use the `line` variant for page-level navigation tabs (Notes: Context / AI / History).

### Dialog

Max width `calc(100% - 2rem)`. Rounded-lg. Overlay: `bg-black/50 backdrop-blur-sm`.  
Entrance: `scale(0.97) + y(4px) → 1 + 0` via `modalIn` variant.

### Sheet

Side panels (right/left). Width `var(--panel-width-md)` (352px).  
Entrance: `slideRight` variant (16px x-translate).

---

## 8. Navigation

### Sidebar (desktop)

Width: `14rem` (224px). Background: `bg-sidebar`. Border: `border-r border-sidebar-border`.

**Structure:**
```
Sidebar
├── Workspace switcher (top)
├── Primary section
│   ├── Home
│   └── AI Edits (with badge)
├── Build section (collapsible)
│   ├── Skills
│   ├── Agents
│   ├── Workflows
│   └── Branches
├── Explore section (collapsible)
│   └── Knowledge Graph
├── Recent notes (5 max)
├── Collections tree
└── Footer: Settings | Theme toggle | User menu
```

**Nav item anatomy:**
- Height: `h-8` (32px)
- Padding: `px-2`
- Icon: `h-4 w-4`, `text-muted-foreground`
- Label: `text-sm font-medium`
- Active: `bg-sidebar-accent text-sidebar-foreground` + `aria-current="page"`
- Hover: `bg-sidebar-accent/60`
- Section headers: `.text-overline` — 11px, uppercase, `text-muted-foreground/60`

**Motion:** Nav items stagger-animate in on mount with `staggerContainer(0.03)`.

### Topbar (desktop)

Height: `h-12` (48px). `border-b border-border`.  
Left: breadcrumbs. Right: `GlobalSearch` + `Ask AI` button + user actions.

### Mobile sidebar

Sheet-based drawer, `w-72`.  
Entrance: `slideRight` variant.

---

## 9. Visual Hierarchy Rules

1. **One primary action per surface.** Never two `default` buttons side by side.
2. **Border-first depth.** Cards use `border border-border`, not box-shadows, at rest.
3. **Whitespace is voice.** Padding within sections is never less than `p-4`.
4. **Section headers are whispers.** `.text-overline` — small, muted, uppercase. They organize; they don't compete.
5. **Icons are 16px (h-4) in lists, 14px (h-3.5) in dense rows, never larger than 20px in chrome.**
6. **Destructive actions are red-tinted but not alarming** — `destructive` button is a muted red fill, not a saturated alarm-red.
7. **Iris accent is reserved for interactive signal** — links, focus rings, the AI/Atlas brand mark. Never used decoratively.
8. **Status badges live at the edge** — right-aligned in list rows, top-right in cards. Never inline in a sentence.
9. **Empty states earn their space** — title, description, one action CTA, optional illustration. All centered.
10. **Dark mode is equal, not inverted** — every token has an explicit dark value. Never use CSS `filter: invert()`.

---

## 10. Animation & Interactions

All variants are exported from `src/lib/motion.ts`. Never define ad-hoc animation props inline.

### Duration tokens

| Name | ms | Use |
|------|----|-----|
| `instant` | 80ms | Tooltip show, focus ring |
| `fast` | 140ms | Exit transitions, hover color |
| `normal` | 200ms | **Default** — entrance, state change |
| `slow` | 280ms | Sheet slide, sidebar collapse |
| `deliberate` | 420ms | Onboarding, celebration |
| `page` | 240ms | Route transitions |

### Easing tokens

| Name | Curve | Use |
|------|-------|-----|
| `standard` | `cubic-bezier(0.2, 0, 0, 1)` | Default for all transitions |
| `enter` | `cubic-bezier(0, 0, 0.2, 1)` | Elements entering the screen |
| `exit` | `cubic-bezier(0.4, 0, 1, 1)` | Elements leaving |
| `emphasized` | `cubic-bezier(0.32, 0.72, 0, 1)` | Page transitions, hero entrances |
| `spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Gentle spring overshoot |

### Spring presets

| Preset | Stiffness | Damping | Use |
|--------|-----------|---------|-----|
| `snappy` | 380 | 30 | Buttons, toggles, cards |
| `gentle` | 220 | 28 | Sheets, drawers, large panels |
| `bouncy` | 300 | 18 | Celebratory micro-moments only |
| `stiff` | 500 | 38 | Tab indicators, active state snaps |

### Variant reference

| Variant | Entrance | Exit | Use |
|---------|---------|------|-----|
| `fadeIn` | opacity 0→1 | opacity 1→0 | Static content |
| `fadeRise` | opacity + y(4px) | opacity + y(-4px) | **Default for all UI elements** |
| `fadeRiseHero` | opacity + y(8px) | — | Page headers, hero |
| `slideRight` | opacity + x(16px) | opacity + x(16px) | Sheets, side panels |
| `slideUp` | opacity + y(16px) | opacity + y(16px) | Bottom sheets, mobile |
| `popIn` | scale(0.96) + opacity | scale(0.96) | Popovers, tooltips, dropdowns |
| `modalIn` | scale(0.97) + y(4px) | scale(0.98) | Dialogs |
| `crossfade` | opacity | opacity | Tab content, route swap |

### Stagger pattern

Use `<PageStagger>` + `<StaggerItem>` (from `src/components/product/page_transition.tsx`) for any list of ≥3 items. Default cadence: **40ms between items**.

```tsx
<PageStagger>
  {items.map((item) => (
    <StaggerItem key={item.id}>
      <ItemRow item={item} />
    </StaggerItem>
  ))}
</PageStagger>
```

### Hover/press rules

- Cards, rows: `whileHover={hoverLift}` (y: -1px), `whileTap={tapPress}` (scale: 0.98)
- Icon buttons: `whileHover={hoverScale}` (scale: 1.04)
- Nav items: CSS transition only — no JS spring (performance)
- **Never animate width/height directly** — use `max-height` + `opacity` or `layout` prop

### Respect reduced motion

`MotionConfig reducedMotion="user"` is set globally in `MotionProvider`. All variants automatically collapse to instant/opacity-only transitions. No additional code needed per-component.

---

## 11. Dashboard / Home Screen

The home screen IS the Atlas AI conversation (`mode="page"` OperatorPanel). No widgets, no sidebars, no panels on top of panels.

### Layout

```
AppShell
└── Main
    └── OperatorPanel (mode="page")
        ├── Session sidebar (left, collapsible)
        ├── Conversation thread (center, scrollable)
        └── Input area (bottom, sticky)
```

### Motion

- Thread messages: each message `fadeRise` on mount, stagger 30ms
- Input area: `slideUp` on focus
- Session sidebar: `slideRight` on expand

### Empty state (no prior runs)

- Centered hero text + subtitle
- 3–4 suggested prompt chips
- All via `<PageStagger>` with stagger 60ms (slower = more considered)

---

## 12. Auth Pages

### Sign-in / Sign-up

**Layout:** 50/50 split on desktop, stacked on mobile.

**Left panel (brand):**
- Background: `oklch(0.10 0.005 265)` — deep graphite with faint iris undertone
- Iris glow blob (restrained — opacity 0.35)
- Logo + tagline: "Your AI knows your notes."
- Feature list: 3 bullet points, `text-sm text-white/70`
- Motion: `fadeRiseHero` stagger on mount — logo first, then tagline, then features

**Right panel (form):**
- Background: `bg-background` (pure white / dark)
- Centered `max-w-sm` form
- Auth provider buttons: `variant="secondary"` (bordered, neutral)
- Submit: `variant="default"` (solid primary)
- Legal footer links: `text-caption text-muted-foreground`

### Motion on auth pages
- Left panel elements: `staggerContainer(0.08, 0.1)` — slower, cinematic
- Right panel form: `fadeRise` at `delayChildren: 0.2` — form arrives after the brand

---

## 13. Tailwind Utility Reference

### Custom utilities defined in globals.css

| Class | What it does |
|-------|-------------|
| `.text-display` | 40px / 600 / -0.024em |
| `.text-headline` | 26px / 600 / -0.020em |
| `.text-title` | 18px / 600 / -0.014em |
| `.text-body-lg` | 16px / 400 / 1.55 lh |
| `.text-body` | 14px / 400 / 1.55 lh |
| `.text-caption` | 12px / 400 |
| `.text-overline` | 11px / 600 / uppercase / +0.08em |
| `.text-mono` | Geist Mono + ss01/ss02 |
| `.text-iris` | Iris indigo text |
| `.bg-iris` | Iris indigo background |
| `.surface-base/raised/overlay/sunken` | Layered neutral backgrounds |
| `.border-subtle/default/strong` | Semantic border colors |
| `.transition-standard` | All props, 200ms, standard easing |
| `.transition-fast` | Color/bg/border/opacity/transform, 140ms |
| `.focus-ring` | ring-2 ring-ring ring-offset-2 |
| `.skeleton` | animate-pulse + bg-muted + rounded-sm |
| `.hairline` | 1px bottom border at `--border-subtle` |
| `.grid-bg-dots` | 20px radial-gradient dot grid |
| `.page-container` | max-w-[1280px] centered px-6 |
| `.page-content` | max-w-[1024px] centered px-6 |
| `.page-narrow` | max-w-[672px] centered px-6 |

---

## 14. Z-Index Layer System

| Layer | Value | Used for |
|-------|-------|---------|
| `base` | 0 | Default stacking |
| `raised` | 10 | Raised cards, sticky headers |
| `dropdown` | 100 | Dropdown menus, select |
| `sticky` | 200 | Sticky topbar |
| `drawer` | 300 | Side sheets, drawers |
| `modal` | 400 | Dialogs |
| `toast` | 500 | Toast notifications |
| `overlay` | 600 | Full-screen overlays |
| `command` | 700 | Command palette (highest) |

---

## 15. Do & Don't

### Do
- Use `cn()` for every `className` that has conditionals
- Use `motion/react-m` (tree-shakable) imports inside `LazyMotion` boundaries
- Use `aria-current="page"` on active nav items
- Use `data-slot="..."` attributes on all custom component roots for CSS targeting
- Use status variants (`success`, `warning`, `error`) on `Badge` for all status display
- Prefer `gap-*` over margins for spacing between siblings

### Don't
- Never use `filter: invert()` for dark mode
- Never animate `width`, `height`, or `max-width` directly — animate `opacity + transform`
- Never put two `variant="default"` buttons side by side
- Never use `rounded-full` on buttons in app chrome (avatars and count badges only)
- Never use arbitrary values (`w-[237px]`) — snap to the nearest 4px grid token
- Never use `z-index` values outside the Z-Index Layer System above
- Never use `!important` in component code
- Never define animation variants inline — import from `src/lib/motion.ts`
