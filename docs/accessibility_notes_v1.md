# Accessibility notes V1

Concrete accessibility improvements made in the product maturity pass.

---

## Skip link

A "Skip to main content" link is rendered at the top of `AppShell`. It is visually
hidden until focused (via keyboard Tab) and jumps the user to `#main-content`.

```
src/components/product/app_shell.tsx
  <a href="#main-content" className="sr-only focus:not-sr-only …">
    Skip to main content
  </a>
  …
  <main id="main-content" tabIndex={-1}>…</main>
```

`tabIndex={-1}` on the `<main>` element allows the skip link to programmatically
focus it. Without this, some browsers don't move focus on `href="#id"` clicks.

---

## Landmark semantics

### AppShell

- Wrapped children in a `<main id="main-content">` landmark
- Sidebar rendered as `<aside>` (already was) with `aria-label="Sidebar navigation"`

### AppSidebar

- Primary nav wrapped in `<nav aria-label="Primary navigation">` with `<ul>/<li>` list
- Boxes section wrapped in `<nav aria-label="Boxes">` with `<ul>/<li>` list
- Logo wordmark div marked `aria-hidden="true"` (decorative)
- `aria-current="page"` added to active nav items

### MobileSidebar

- Same landmark pattern as desktop sidebar
- Primary nav: `<nav aria-label="Primary navigation">` with `<ul>/<li>`
- Boxes: `<nav aria-label="Boxes">` with `<ul>/<li>`
- Hamburger button has `aria-label="Open navigation menu"` and `aria-expanded`
- Close button has `aria-label="Close navigation menu"`

---

## Icon-only buttons

Buttons and links that show only an icon now have explicit accessible names:

| Element | Before | After |
|---|---|---|
| Settings link (sidebar) | `title="..."` (tooltip only) | `aria-label="Settings"` |
| Manage workspace (sidebar) | `title="Workspace"` | `aria-label="Manage workspace"` |
| Clear guide note button | `title="Clear guide note"` | `aria-label="Clear guide note assignment"` |
| Mobile hamburger | no label | `aria-label="Open navigation menu"` + `aria-expanded` |
| Mobile close | no label | `aria-label="Close navigation menu"` |
| Note lifecycle actions | already had aria-label | preserved |
| Folder lifecycle actions | already had aria-label | preserved |

All `lucide-react` icons in these contexts have `aria-hidden="true"` to prevent
screen readers from announcing the SVG element name.

---

## Focus visibility

Sidebar nav links have explicit `focus-visible:ring-2 focus-visible:ring-ring`
classes. This applies to:

- `NavItem` in `AppSidebar`
- `BoxNavItem` in `AppSidebar`
- All links in `MobileSidebar`
- The workspace manage link in `AppSidebar`
- The settings link in `AppSidebar`

These complement Tailwind's default focus-visible behavior and ensure keyboard
users can see where focus is at all times in the nav.

---

## Template picker in CreateBoxDialog

The template picker uses `aria-pressed` on toggle buttons (box template cards)
and `role="group"` with `aria-labelledby` on the container. This tells screen
readers the group label and the pressed/unpressed state of each template option.

---

## Error announcements

Error messages in dialogs and menus use `role="alert"` so screen readers announce
them immediately when they appear (live region). This applies to:

- `CreateBoxDialog` error
- `CreateNoteDialog` error
- `GuideNotePicker` guide note error

---

## `aria-current` on navigation

All nav links use `aria-current="page"` when active. This is the correct attribute
for indicating the current page in a navigation landmark (not `aria-selected` which
is for tabs/listboxes).

---

## Mobile nav accessibility

The `MobileSidebar` Sheet component:
- Trigger button announces its state via `aria-expanded`
- Close button has a descriptive label
- Sheet wraps content in a dialog context (Base UI Dialog) which traps focus when open
- All nav items inside follow the same landmark and aria-current pattern as desktop

---

## Semantic lists in navigation

Navigation items that were previously bare divs with `flex-col gap-0.5` are now
proper `<ul>/<li>` lists. This improves screen reader announcements ("list, 4 items")
and provides semantic meaning to the groupings.

Same improvement applied to box lists on the home page (recent notes, box cards).

---

## What was not addressed (follow-on)

- Color contrast audit — deferred; requires design token review
- Full ARIA live region audit for async operations (proposal approval, etc.)
- Keyboard-interactive tree view (BoxContentsTree is currently read-only links)
- Focus restoration after dialog close (Base UI Dialog handles this natively)
- Roving tabindex for tab components (Tabs uses Base UI which provides this)
