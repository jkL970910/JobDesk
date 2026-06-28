---
name: JobDesk
description: Evidence-grounded career workspace for resume, job, interview, and application decisions.
colors:
  deep-workspace-black: "#070a11"
  workspace-black-soft: "#0c111b"
  panel-base: "#111827"
  panel-soft-base: "#161e2d"
  panel-raised-base: "#1a2437"
  ink: "#f4f7ff"
  ink-soft: "#c8d2e6"
  muted: "#8b96aa"
  faint: "#5f6b7e"
  line: "#ffffff17"
  line-strong: "#ffffff29"
  signal-blue: "#4f8cff"
  signal-blue-strong: "#9ec3ff"
  signal-blue-soft: "#4f8cff26"
  review-amber: "#f3c775"
  review-amber-soft: "#f3c7751f"
  risk-red: "#ff7f8d"
  risk-red-soft: "#ff7f8d1f"
  verified-green: "#7ddfb3"
  verified-green-soft: "#7ddfb31f"
typography:
  display:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(2rem, 3vw, 2.5rem)"
    fontWeight: 920
    lineHeight: 0.98
    letterSpacing: "-0.045em"
  headline:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "clamp(1.5rem, 2.2vw, 1.85rem)"
    fontWeight: 880
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  title:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "1.18rem"
    fontWeight: 780
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.92rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Aptos, Segoe UI, Helvetica Neue, Arial, sans-serif"
    fontSize: "0.72rem"
    fontWeight: 850
    lineHeight: 1.2
    letterSpacing: "0.045em"
  mono:
    fontFamily: "Cascadia Code, SFMono-Regular, Consolas, monospace"
rounded:
  xs: "8px"
  sm: "12px"
  md: "14px"
  lg: "18px"
  xl: "22px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "18px"
  xxl: "22px"
components:
  button-primary:
    backgroundColor: "{colors.signal-blue}"
    textColor: "{colors.deep-workspace-black}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
    padding: "10px 14px"
  button-secondary:
    backgroundColor: "{colors.signal-blue-soft}"
    textColor: "{colors.signal-blue-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  panel:
    backgroundColor: "{colors.panel-base}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xl}"
    padding: "18px"
  card-row:
    backgroundColor: "{colors.deep-workspace-black}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "12px 14px"
  input:
    backgroundColor: "{colors.workspace-black-soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.xs}"
    padding: "8px 10px"
  chip:
    backgroundColor: "{colors.signal-blue-soft}"
    textColor: "{colors.signal-blue-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: JobDesk

## 1. Overview

**Creative North Star: "Career Evidence Workspace"**

JobDesk is a focused career workspace for turning raw career material into evidence-backed decisions. The visual system should feel precise, trustworthy, and career-serious: a calm place to inspect source material, review claims, approve public-safe wording, and create application assets without theatrical AI behavior.

The product uses a dark, restrained working surface with blue as the primary signal color. Its panels, rows, tabs, and workflow states should support concentration and review rather than spectacle. The interface can be information-rich, but it should help the user focus on one decision at a time.

JobDesk explicitly rejects generic AI resume chatbot styling, flashy SaaS landing-page treatment, gamified productivity patterns, and dense engineering-console language. The design should expose workflow state, evidence readiness, and next actions in user-facing terms.

**Key Characteristics:**
- Focused, explicit, review-first controls.
- Dark workspace surfaces with restrained Signal Blue emphasis.
- Translucent panels and 1px borders used for structure, not decoration.
- Compact but readable typography with strong labels and tabular metrics.
- Clear status language for evidence, review, readiness, risk, and verification.

## 2. Colors

The JobDesk palette is a dark workspace system with Signal Blue reserved for navigation, primary actions, focus, and active review state.

### Primary
- **Signal Blue**: The primary action and selection color. Use it for current navigation, focused workflow steps, active tabs, primary buttons, and high-confidence interactive emphasis.
- **Signal Blue Strong**: The readable text version of Signal Blue. Use it on dark surfaces for active labels, links, chips, and selected states.
- **Signal Blue Soft**: The low-emphasis Signal Blue fill. Use it for active row backgrounds, filter chips, and hover states that should remain calm.

### Secondary
- **Review Amber**: The warning and review-needed color. Use it for material that requires user attention, blocked review states, incomplete story targets, and conservative guardrail messaging.
- **Verified Green**: The ready or verified color. Use it only when an item has passed the relevant review gate or is clearly eligible for use.
- **Risk Red**: The error or risk color. Use it for failed actions, blocked export states, destructive actions, or sensitive warnings.

### Neutral
- **Deep Workspace Black**: The app background and deepest working surface.
- **Workspace Black Soft**: The secondary background layer for fields, inset rows, and quiet panels.
- **Panel Base / Panel Soft / Panel Raised**: The panel family. In implementation these usually appear as translucent surfaces over the deep background.
- **Ink / Ink Soft**: Primary and secondary text.
- **Muted / Faint**: Supporting text and low-priority metadata. Keep contrast at WCAG AA levels.
- **Line / Line Strong**: Structural borders and dividers.

### Named Rules
**The Signal Rarity Rule.** Signal Blue should identify current action, selection, and confidence. Do not let it become decoration across every card.

**The Evidence State Rule.** Review Amber, Verified Green, and Risk Red are semantic colors. Never use them just to add variety.

**The No Chatbot Glow Rule.** Do not add neon, purple, cyan, or gradient-heavy AI styling. JobDesk is an evidence workspace, not a generic AI assistant shell.

## 3. Typography

**Display Font:** Aptos with Segoe UI, Helvetica Neue, Arial, sans-serif fallback  
**Body Font:** Aptos with Segoe UI, Helvetica Neue, Arial, sans-serif fallback  
**Label/Mono Font:** Cascadia Code with SFMono-Regular and Consolas fallback for technical or diagnostic fragments only

**Character:** The type system is a single practical sans stack tuned for product clarity. It uses heavy labels and compact headings to create hierarchy without making the workspace feel like a landing page.

### Hierarchy
- **Display** (920, clamp scale, 0.98 line-height): Use for page-level dashboard or major workspace headings only.
- **Headline** (880, section scale, 1.08 line-height): Use for panel headings and major workflow sections.
- **Title** (780, 1.18rem, 1.15 line-height): Use for cards, rows, tabs, and task titles.
- **Body** (400, 0.92rem, 1.55 line-height): Use for explanatory copy, review details, and longer user-facing descriptions. Keep prose short and cap long reading lines around 65-75ch.
- **Label** (850, 0.72rem, 0.045em letter-spacing): Use for metadata labels, status captions, compact navigation descriptions, and small workflow markers.

### Named Rules
**The Product-Scale Rule.** Use compact fixed sizes for working surfaces. Avoid oversized hero typography except on the highest-level dashboard context.

**The User-Language Rule.** Labels should say what the user can act on: Evidence Claim, Work Experience, Story Target, Review, Resume-ready. Do not surface provider, schema, retry, or workflow-run language in normal UI.

## 4. Elevation

JobDesk uses layered but restrained elevation. Depth comes from translucent panels, 1px borders, tonal layering, and selective shadows for sticky navigation, popovers, and important focus states. Most working rows should stay flat at rest.

### Shadow Vocabulary
- **App topbar shadow** (`0 20px 70px rgba(0, 0, 0, 0.28)`): Sticky navigation depth.
- **Panel shadow** (`0 16px 44px rgba(0, 0, 0, 0.2)`): Major panels only when separation from the background is needed.
- **Popover shadow** (`0 24px 70px rgba(0, 0, 0, 0.38)`): Menus and overlays.
- **Focus glow** (`0 0 0 1px rgba(158, 195, 255, 0.22), 0 22px 90px rgba(79, 140, 255, 0.16)`): Explicit focus or selected state, not ambient decoration.

### Named Rules
**The Flat Review Row Rule.** Rows, evidence cards, and queue items should use borders and tonal fills before shadows. A shadow means elevation or focus, not default decoration.

**The Popover Depth Rule.** Stronger shadows belong to menus, sticky navigation, and transient overlays where spatial layering helps orientation.

## 5. Components

### Buttons
- **Shape:** Compact rounded rectangles or pills depending on context. Primary workspace buttons use restrained corners (8-9px); secondary row actions often use pills.
- **Primary:** Signal Blue gradient or Signal Blue fill with dark text, heavy label typography, and 10px 14px padding.
- **Hover / Focus:** Hover may lift by 1px and shift the fill toward Signal Blue Soft. Focus must use the visible global outline.
- **Secondary / Ghost / Tertiary:** Use translucent dark or Signal Blue Soft fills with 1px borders. Secondary buttons should feel like actions, not badges.

### Chips
- **Style:** Pill-shaped status or filter markers using semantic soft fills and high-contrast text.
- **State:** Selected chips use Signal Blue Soft and Signal Blue Strong. Review, risk, and verified chips use Amber, Red, and Green only for true state.

### Cards / Containers
- **Corner Style:** Major panels use 18-22px only where the existing shell already does. Working rows and review cards should use 8-14px.
- **Background:** Translucent panel surfaces over Deep Workspace Black.
- **Shadow Strategy:** Major panels may use the panel shadow; rows should use borders and tonal fills.
- **Border:** 1px lines are the default structure.
- **Internal Padding:** Use 12-18px for working surfaces, with tighter 8-12px controls in dense lists.

### Inputs / Fields
- **Style:** Dark inset surfaces with 1px borders, 8-12px radius, and readable Ink text.
- **Focus:** Use the global 3px Signal Blue focus outline and border shift.
- **Error / Disabled:** Risk Red for true failure states; disabled controls reduce opacity but must remain legible.

### Navigation
- **Style:** Sticky top navigation uses translucent dark background, 1px border, 24px radius, and a structural shadow.
- **Typography:** Navigation labels use compact heavy text and avoid long helper copy.
- **Default / Hover / Active:** Default items are muted; hover and active states use Signal Blue Soft fills, stronger borders, and Ink text.
- **Mobile Treatment:** Preserve horizontal scroll where needed, but avoid hidden critical actions.

### Workflow Stepper
Workflow steps use small numbered circles, compact labels, and semantic active/blocked/complete states. The stepper should make the next decision obvious without turning the screen into a game.

### Review Panels
Review panels combine source context, status, eligibility, and action controls. They should keep one primary action visible, show why an item needs review, and avoid burying provenance behind vague AI language.

## 6. Do's and Don'ts

### Do:
- **Do** use `Deep Workspace Black`, translucent panel bases, and 1px lines to create a calm working environment.
- **Do** reserve `Signal Blue` for primary actions, current selection, focused workflow steps, and active review state.
- **Do** use `Review Amber`, `Verified Green`, and `Risk Red` only for real semantic states.
- **Do** keep controls focused, explicit, and review-first: one primary decision per local surface whenever possible.
- **Do** keep WCAG AA contrast for body text, labels, inputs, buttons, and placeholder text.
- **Do** keep reduced-motion behavior for every animation and use motion to show state, loading, or focus.
- **Do** use user-facing career language such as Evidence Claim, Work Experience, Story Target, Resume-ready, and Review.

### Don't:
- **Don't** make JobDesk feel like a generic AI resume chatbot.
- **Don't** use flashy SaaS landing-page composition, hero-metric templates, or marketing-style decorative sections inside the app.
- **Don't** make the product feel like a gamified productivity app. Progress indicators should clarify work, not chase streaks or points.
- **Don't** make the workspace feel like a dense engineering console. Avoid exposing provider names, retry counts, schema labels, sourceMode, DTO, workflow-run, or debug concepts as primary user-facing language.
- **Don't** use neon AI glow, purple gradients, cyan-on-dark AI tropes, gradient text, glassmorphism, or decorative bokeh/orbs.
- **Don't** nest cards inside cards. Use flat bands, rows, tables, and clear dividers for grouped work.
- **Don't** use side-stripe borders as accent decoration. Use full borders, semantic chips, or clear row state instead.
