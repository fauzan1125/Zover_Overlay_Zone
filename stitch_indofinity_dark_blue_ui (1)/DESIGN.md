---
name: Obsidian Telemetry
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#c2c6d6'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#8c909f'
  outline-variant: '#424754'
  surface-tint: '#adc6ff'
  primary: '#adc6ff'
  on-primary: '#002e6a'
  primary-container: '#4d8eff'
  on-primary-container: '#00285d'
  inverse-primary: '#005ac2'
  secondary: '#4cd7f6'
  on-secondary: '#003640'
  secondary-container: '#03b5d3'
  on-secondary-container: '#00424e'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00a572'
  on-tertiary-container: '#00311f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#d8e2ff'
  primary-fixed-dim: '#adc6ff'
  on-primary-fixed: '#001a42'
  on-primary-fixed-variant: '#004395'
  secondary-fixed: '#acedff'
  secondary-fixed-dim: '#4cd7f6'
  on-secondary-fixed: '#001f26'
  on-secondary-fixed-variant: '#004e5c'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  headline-xl:
    fontFamily: Geist
    fontSize: 2rem
    fontWeight: '600'
    lineHeight: 2.25rem
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: Geist
    fontSize: 1.5rem
    fontWeight: '600'
    lineHeight: 1.75rem
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 1.125rem
    fontWeight: '600'
    lineHeight: 1.5rem
    letterSpacing: -0.015em
  body-lg:
    fontFamily: Geist
    fontSize: 0.9375rem
    fontWeight: '400'
    lineHeight: 1.375rem
    letterSpacing: -0.005em
  body-md:
    fontFamily: Geist
    fontSize: 0.8125rem
    fontWeight: '400'
    lineHeight: 1.25rem
    letterSpacing: 0em
  body-sm:
    fontFamily: Geist
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: 1rem
    letterSpacing: 0em
  data-metric:
    fontFamily: JetBrains Mono
    fontSize: 1.25rem
    fontWeight: '500'
    lineHeight: 1.5rem
    letterSpacing: -0.02em
  label-mono:
    fontFamily: JetBrains Mono
    fontSize: 0.6875rem
    fontWeight: '500'
    lineHeight: 0.875rem
    letterSpacing: 0.04em
  label-badge:
    fontFamily: Geist
    fontSize: 0.625rem
    fontWeight: '600'
    lineHeight: 0.75rem
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  margin: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1rem
  space-xl: 1.5rem
---

## Brand & Style

The design system is engineered for professional live broadcasters, esports production operators, and technical creators who treat streaming as mission-critical broadcast engineering. The interface embodies precision, low cognitive friction during active live broadcasts, and absolute technical reliability. It avoids ornamental design cliches—such as decorative gradient meshes, arbitrary floating 3D glass shapes, and wasteful whitespace—in favor of dense, purposeful telemetry and razor-sharp data visualization.

The design movement is **Technical Minimalism**:
- **Tone:** Authoritative, tactical, engineered, and focused.
- **Visual Tension:** Pitch-black structural panels offset by micro-scale electric status indicators, laser-thin borders, and high-legibility tabular metrics.
- **Experience:** Information radiates instantly without hunting. High-contrast state changes notify operators of dropped frames, bitrate dips, or audio clipping without breaking flow state.

## Colors

The palette is tuned specifically for low-light production studios and late-night broadcast environments, prioritizing zero eye-strain while preserving high semantic contrast.

### Palette Architecture
- **Canvas & Surface Architecture:**
  - Base Background: `#0B0F17` (Deep Obsidian Void)
  - Surface Substrate (Cards, Toolbars): `#111827` (Charcoal Slate)
  - Elevated Popovers & Menus: `#1F2937`
  - Subtle Inset Wells: `#070A0F`
- **Primary Electric Arc:** `#3B82F6` (Electric Blue) with active hover `#60A5FA` and compressed active click `#2563EB`. Used for primary affirmative actions, selected telemetry tabs, and signal pathways.
- **Secondary Telemetry Blue:** `#06B6D4` (Cyan Laser). Applied to network throughput, downstream ingest feeds, and real-time audio pipeline statuses.
- **Semantic Broadcast Status:**
  - `Live / Optimal`: `#10B981` (Emerald Phosphor)
  - `Warning / Frame Drop`: `#F59E0B` (Amber Hazard)
  - `Critical / Stream Severed`: `#EF4444` (Crimson Alert)
- **Structural Outlines:**
  - Default Hairline: `#1F2937`
  - Highlight Hairline (Selected / Active): `rgba(37, 99, 235, 0.35)`
  - Subdued Divider: `#161F2E`

## Typography

Typography functions as a tool of measurement and swift legibility. The primary structural typeface is **Geist**, offering sharp geometry, tall x-height, and dense horizontal tracking. Numeric metrics, live clocks, bitrates, audio decibels, and server IDs utilize **JetBrains Mono** with tabular lining figures (`tnum`, `zero`) to prevent metric jitter during real-time streaming updates.

### Rules of Engagement
- **Tabular Alignment:** All real-time telemetry numbers (FPS, bitrate, uptime, dropped frames) must enforce monospace rendering with slashed zeros.
- **Case Conventions:** Metadata category tags, connection protocol stamps, and status badges must use uppercase micro-labels with `letterSpacing: 0.04em` to `0.06em` to maintain legible clarity at tiny sizes (10px–11px).
- **Weight Restraint:** Limit weights strictly to 400 (regular readouts), 500 (tabular data), and 600 (headers and semantic badges). Ultra-bold weights (700+) are avoided to preserve surgical crispness.

## Layout & Spacing

The layout is built upon an uncompromising **Compact Fluid Grid** structured around a dense modular dashboard. Broad whitespace is intentionally curtailed; screen real estate is reserved for live video canvas previews, scene switchers, hardware metrics, audio mixers, and ingest health stats.

### Grid & Responsiveness
- **Desktop Focus (Primary Viewport: 1440px to 2560px):** Dynamic CSS Grid using 12 to 16 columns with persistent 48px or 56px utility control rails on the flanks.
- **Density Scaling:**
  - Component padding operates on a 4px/8px incremental base (`space-xs` = 4px, `space-sm` = 8px, `space-md` = 12px, `space-lg` = 16px).
  - Cards and dashboard widgets use `0.75rem` internal padding to maximize data-per-square-inch.
- **Adaptive Behavior:** Sub-panels auto-collapse into iconized vertical tool-drawers below 1280px screen widths, retaining persistent video canvas integrity and core audio meters.

## Elevation & Depth

This design system deliberately rejects heavy, murky drop-shadows and generic blurred gradient blooms. Visual elevation is established purely via **Tonal Layering** and **Razor Hairline Borders**.

### Depth Hierarchy
1. **Base Deck (`#0B0F17`):** The structural viewport foundation behind all panes.
2. **Substrate Layer (`#111827`):** Operational panels, persistent telemetry rows, and card chassis. Outlined by a crisp `1px solid #1F2937` border.
3. **Interactive & Floating Layer (`#1F2937`):** Dropdown selectors, active modal dialogs, and popover tooltips. Framed with `1px solid rgba(59, 130, 246, 0.3)` to designate focus.
4. **Active State Glow:** Subtle, directional ambient light is restricted strictly to active statuses (e.g., `0 0 10px rgba(16, 185, 129, 0.2)` on the `LIVE` node, or `0 0 12px rgba(37, 99, 235, 0.25)` on active primary actions).

## Shapes

The shape system employs an engineered **Soft Compact** geometry (`roundedness: 1`):
- **Base Components:** Form controls, action buttons, table cell badges, and metric cards feature a minimal `0.25rem` (4px) border radius.
- **Panels & Overlays:** Large workspace containers and contextual overlays use `0.375rem` (6px) up to a maximum of `0.5rem` (8px).
- **Connection Indicator Dots & Signal Pips:** Fully circular (`rounded-full` / 9999px) for clean optical recognition.
- **Sharp Alignment:** Avoid pill shapes for standard buttons or inputs to maintain an industrial, rack-mount equipment identity.

## Components

### Buttons & Interactive Triggers
- **Primary Broadcast Action:** Background `#2563EB`, text `#FFFFFF`, border `1px solid #3B82F6`. Hover triggers background `#1D4ED8` and crisp rim highlight.
- **Secondary Utility Action:** Background `#111827`, text `#E5E7EB`, border `1px solid #1F2937`. Hover brings border to `#374151` and text to `#FFFFFF`.
- **Destructive/Cut Signal:** Dark maroon background `#450A0A`, text `#FCA5A5`, border `1px solid #991B1B`.

### Status Micro-Badges & Telemetry Tags
- Ultra-compact height (18px–20px) with `0.25rem` radius.
- Composed of an inner 6px glowing status dot, paired with uppercase `label-mono` typography.
- States:
  - `ON AIR`: Background `rgba(16, 185, 129, 0.1)`, dot `#10B981` with pulse animation, border `1px solid rgba(16, 185, 129, 0.3)`.
  - `RTMP DROP`: Background `rgba(239, 68, 68, 0.1)`, dot `#EF4444`, border `1px solid rgba(239, 68, 68, 0.3)`.
  - `STANDBY`: Background `rgba(107, 114, 128, 0.1)`, dot `#9CA3AF`, border `1px solid #374151`.

### Data Cards & Metric Readouts
- Minimal container padding (`0.75rem`), structured with a two-row internal hierarchy:
  - Top row: Diminutive muted label (`label-mono`, `#9CA3AF`) and icon or health badge.
  - Bottom row: High-contrast metric (`data-metric`, `#F9FAFB`) paired with sparkline or delta percentage.
- Separated by hairline borders (`#1F2937`) with zero box-shadow.

### Inputs & Toggles
- **Text & Numeric Inputs:** Jet-black recessed field (`#070A0F`), border `1px solid #1F2937`, focused border `1px solid #3B82F6` with zero outer glow ring clutter. Monospaced font for bitrate, keyframe, and port inputs.
- **Toggle Switches:** Compact rectangular track (32px width, 18px height) with 2px inner slider thumb. Inactive: `#1F2937`; Active: `#2563EB`.

### Connection & Stream Protocol Nodes
- Horizontal row items featuring service branding (Twitch, YouTube, Kick, Custom RTMP/SRT), ingest ping latency in `JetBrains Mono` (e.g., `18ms`), bandwidth consumption graph, and a hardware switch toggle.