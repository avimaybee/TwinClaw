---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, or applications. Generates creative, polished code that avoids generic AI aesthetics.
---

This skill exists because AI-generated interfaces converge on a recognizable, low-density aesthetic ("The Vercel Clone"). Your job is to produce work that looks like a specific human made it for a specific reason.

## Step 1 — The Context Derivator (Mental Sandbox)

Do not write code until you answer these three questions. Be specific.

**1. The "World" & Density:**
Where does this live?
- *High-Stress/Utility (e.g., Trading, Medical, Admin):* Needs **High Density**. Small type (12-14px / `text-xs` or `text-sm`), tight spacing, visible borders, information-first. Distinctiveness comes from *layout precision*, not decoration.
- *Low-Stress/Expression (e.g., Portfolio, Marketing, Lifestyle):* Needs **Low Density**. Large type, generous whitespace, novel layouts. Distinctiveness comes from *typographic confidence*.

**2. The Constraint:**
Pick ONE constraint that shapes the design:
- "Must work in direct sunlight" -> High contrast, no subtle grays.
- "Used primarily via keyboard" -> Focus states are the primary aesthetic.
- "Data-heavy dashboard" -> No "cards", use tables/lists only.
- "Editorial focused" -> No images, typography carries the weight.

**3. The "Signature" Interaction:**
Define ONE non-standard interaction or visual element that defines this app:
- *Example:* "A persistent sidebar that never scrolls."
- *Example:* "Headings that are smaller than the body copy but bolder."
- *Example:* "A monochrome palette where the only color is the cursor."
- *Example:* "Grid lines are always visible."

---

## Step 2 — The One-Sentence Commit

Summarize your direction in one sentence.
*Example: "A utilitarian, high-density dashboard for data entry, using monospace fonts and visible grid lines, with no shadows or rounded corners."*

---

## Step 3 — Visual Execution Guidelines

### Typography: Use Cultural Reasoning
Avoid the "AI Default" stack: Inter, Roboto, Open Sans, Poppins, Space Grotesk. Do not just pick a category; reason about its **cultural association**:
- **Utility & Engineering:** Use a high-quality Monospace (JetBrains Mono, IBM Plex Mono) to evoke documentation, code, and precision.
- **Authority & History:** Use a transitional or high-contrast Serif (EB Garamond, Libre Baskerville) to evoke editorial, legacy, and trust.
- **Modernity & Neutrality:** Use a grotesque (Unica77, Public Sans) but *track it tightly* (-0.02em) to evoke mid-century Swiss design.
- **Warmth & Humanism:** Use a humanist sans (Gill Sans, Optima) to evoke friendliness without the "softness" of rounded fonts.

### Color: Derive from a Core Material
- **The Core Rule:** Do not use "primary" colors (pure blue, red, green). Use "Muddy" transitions or "Earth" tones (stone, clay, ink, paper).
- **The Design Logic:** Pick **ONE** material color as your anchor (e.g., `#2D2926` for "Charcoal"). Derive the rest of the palette through relationships:
    - *Surface:* Tint the background with 2-5% of your anchor color.
    - *Borders:* Anchor color at 10-15% opacity.
    - *Contrast:* Anchor color plus a deliberate shift in temperature (e.g., adding 5% blue or amber).
- **Dark Mode:** Do not use `#000000` or `#121212`. Use a specific deep color derived from your anchor (e.g., deeply desaturated navy or forest green).

### Layout: Fight the "Card" Mentality
AI defaults to "Cards in a Grid." This is lazy.
- **Try:** Visible grid lines separating content.
- **Try:** List views instead of cards.
- **Try:** Split-screen layouts (50/50).
- **Try:** Sidebar navigation instead of top-bar.

### Logic: "Does it need to be a card?"
If the content is just text, it doesn't need a background color, a shadow, and a border radius. It just needs *space*.

### Shadows & Radius
- **Strict Consistency:** If you use `rounded-lg`, use it everywhere. If you use `rounded-none`, use it everywhere.
- **Shadows:** Avoid the default distinct "drop shadow". Use subtle, large, diffuse shadows OR harsh, solid, 1px borders (brutalist).

---

## Step 4 — The "Anti-Slop" Checklist

Before outputting code, verify:
1.  **Density Check:** Is the text size 16px+ for a dashboard? -> **Fix it.** (Use 13-14px).
2.  **Whitespace Check:** Am I using `py-24` just to fill space? -> **Fix it.**
3.  **Color Check:** Is the primary color "Blurple" or "Teal"? -> **Change it.**
4.  **Font Check:** Is it Inter or Space Grotesk? -> **Change it.**
5.  **Effect Check:** Am I using Glassmorphism (backdrop-blur)? -> **Remove it.** (Unless explicitly requested).
6.  **Animation Check:** distinct "staggered fade-in"? -> **Remove it.** (Make it instant or a single group fade).
7.  **The Transplant Test:** Could this entire UI be transplanted onto a different product without it feeling generic? If it feels like "The Vercel UI," it **fails.**

---

## Implementation Standards

- **React Architecture:** Functional components with TypeScript. Use semantic tags (`<header>`, `<main>`, etc.) within your JSX components.
- **Tailwind Palette:** Use `tailwind.config.ts` for theme extensions. Define logic-based colors (e.g., `surface-primary`, `text-dimmed`) derived from your anchor color.
- **Accessibility & Motion:**
    - UI must support `prefers-reduced-motion` for all transitions.
    - Interactive elements must satisfy a minimum **44x44px touch target**.
    - Explicit focus states (`focus-visible`) are a requirement, not an afterthought.
- **Performance:** For fonts, ensure `font-display: swap` is used. Use `next/font` or similar for optimized loading.
