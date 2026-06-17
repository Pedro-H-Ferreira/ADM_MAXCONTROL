---
name: Enterprise Logistics System
colors:
  surface: '#fcf8fa'
  surface-dim: '#dcd9db'
  surface-bright: '#fcf8fa'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f6f3f5'
  surface-container: '#f0edef'
  surface-container-high: '#eae7e9'
  surface-container-highest: '#e4e2e4'
  on-surface: '#1b1b1d'
  on-surface-variant: '#45464d'
  inverse-surface: '#303032'
  inverse-on-surface: '#f3f0f2'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006a61'
  on-secondary: '#ffffff'
  secondary-container: '#86f2e4'
  on-secondary-container: '#006f66'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#271901'
  on-tertiary-container: '#98805d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#89f5e7'
  secondary-fixed-dim: '#6bd8cb'
  on-secondary-fixed: '#00201d'
  on-secondary-fixed-variant: '#005049'
  tertiary-fixed: '#fcdeb5'
  tertiary-fixed-dim: '#dec29a'
  on-tertiary-fixed: '#271901'
  on-tertiary-fixed-variant: '#574425'
  background: '#fcf8fa'
  on-background: '#1b1b1d'
  surface-variant: '#e4e2e4'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  code-md:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  code-sm:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  sidenav-width: 240px
  topbar-height: 64px
---

## Brand & Style

The design system is engineered for high-stakes B2B logistics environments. It prioritizes clarity, speed of cognition, and data density. The brand personality is **authoritative, precise, and systematic**, reflecting the scale and complexity of a modern distribution center.

The visual style follows a **Modern Corporate** approach with a focus on **High-Density Minimalism**. This ensures that administrative users can manage thousands of SKUs and logistics workflows without cognitive fatigue. The UI relies on structured hierarchies, subtle transitions, and a strict adherence to a logic-driven layout.

Key brand attributes:
- **Efficiency:** Every pixel serves a functional purpose.
- **Reliability:** A robust color palette that signals stability.
- **Scalability:** Built to handle everything from mobile handheld scans to ultra-wide dashboard monitors.

## Colors

The palette is anchored in **Deep Blue (#0F172A)** to establish a professional enterprise foundation. **Teal (#0D9488)** acts as the secondary driver for action-oriented components, providing a distinct but harmonious contrast.

- **Primary & Secondary:** Used for high-level navigation, primary buttons, and brand reinforcement.
- **Accent:** Reserved for focus states, active indicators, and highlighting critical data trends.
- **Semantic Palette:** Follows strict industry standards to ensure immediate recognition of system status (Success, Warning, Error, Info).
- **Neutrals (Slate/Zinc):** Used for surfaces, borders, and secondary text. In **Dark Mode**, the background transitions to a deep slate tint to maintain depth without pure black fatigue.

All color combinations must meet **WCAG 2.2 AA** contrast ratios, particularly for data labels and interactive states.

## Typography

This design system utilizes **Inter** as the primary typeface for its exceptional legibility and neutral, professional tone. To support the technical nature of logistics (IDs, SKUs, Tracking Numbers), **Geist** is employed for monospaced data entries.

- **Hierarchy:** Use `display-lg` sparingly for dashboard summaries. `headline-md` is the standard for card titles.
- **Density:** `body-sm` and `body-md` are the workhorses of the system, optimized for dense data tables and property panels.
- **Technical Data:** Use the "Code" roles for any alphanumeric identifiers (e.g., `LOT-99283-X`). This visual distinction helps users quickly scan for specific items within large lists.

## Layout & Spacing

The system is built on a strict **8px grid**. This rhythm governs all padding, margins, and component heights, ensuring a mathematical harmony across the portal.

- **AppShell:** Features a persistent **240px Sidenav** on the left for primary navigation and a **64px Topbar** for global search, notifications, and theme switching.
- **Grid System:** A 12-column fluid grid is used for the main content area. In dense administrative views, margins are reduced to `16px` to maximize screen real estate.
- **Density Control:** Components should offer "Comfortable" and "Compact" modes. Compact mode reduces vertical padding to `4px` (xs) for large data tables.
- **Breakpoints:**
  - Mobile (<640px): Sidenav becomes a drawer; content is single-column.
  - Tablet (640px - 1024px): Sidenav collapses to icons.
  - Desktop (>1024px): Full persistent shell.

## Elevation & Depth

To maintain a clean, professional aesthetic, this design system uses **Tonal Layers** and **Low-Contrast Outlines** rather than heavy shadows.

- **Level 0 (Background):** Base surface color.
- **Level 1 (Cards/Panels):** Raised using a subtle `1px` border (Slate-200 in light mode, Slate-800 in dark mode) or a very soft, diffused ambient shadow (4px blur, 2% opacity).
- **Level 2 (Modals/Popovers):** Higher contrast borders and a medium shadow to indicate temporary overlay status.
- **Dark Mode Elevation:** Depth is communicated through increasing brightness of the slate surface. Backgrounds are the darkest, while cards and interactive elements are slightly lighter.

## Shapes

The shape language is **Soft (0.25rem)**. This provides a modern touch without sacrificing the "serious" nature of an enterprise logistics tool.

- **Standard Elements:** Buttons, Inputs, and Cards use the `rounded-sm` (4px) base.
- **Large Containers:** Dashboard widgets or main content areas may use `rounded-lg` (8px).
- **Interactive States:** Use a distinct "focus ring" (2px offset) in the Accent color for accessibility.
- **Status Tags:** Use a slightly higher radius (`rounded-xl`) to distinguish them from actionable buttons.

## Components

### Tables (Data Grids)
The core of the portal. Use **Zebra Striping** and **Fixed Headers**. 
- Row height: 40px (Compact) or 56px (Default).
- Column sorting indicators and inline actions (Edit/Delete) appear on hover.

### KPI Cards
Display vital metrics (e.g., "Active Shipments", "Inventory Value").
- Include a small sparkline chart (Accent color).
- Show "Percentage Change" indicators (Success/Error colors).

### AppShell
- **Sidenav:** High-contrast background (Primary Deep Blue). Active links use a Secondary Teal left-border indicator.
- **Topbar:** Features a centered **Global Search** bar with a keyboard shortcut hint (e.g., `⌘K`). 

### Forms
- **Validation:** Real-time inline validation using Semantic colors. Errors must include an icon for accessibility.
- **Inputs:** Clear labels above the field with optional "Helper Text" below.

### Microinteractions
- Transitions should be fast (**150ms - 200ms**).
- Button "Press" states should provide immediate visual feedback via a slight darkening of the background color.
- Theme switching (Light/Dark) should utilize a cross-fade transition.