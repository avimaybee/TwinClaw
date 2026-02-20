---
name: humanist-web-style
description: A personal design sensibility for web interfaces. Applies to all projects. Sits on top of the base frontend-design skill. Defines the soul of the work — not the surface.
---

# The Humanist Web Sensibility

This is not a visual style. It is a design philosophy that applies across all projects regardless of their aesthetic direction. Every website built under this sensibility should feel like it was **touched by a person** — not generated, not templated, not assembled from a component library.

The surface can vary wildly. The soul should always be the same.

---

## The Core Principle

> **Keep the structure rational. Make the feeling human.**

The underlying grid, spacing system, and information hierarchy stay clean and intentional. Imperfection is introduced *selectively* — in the places where a human hand would naturally leave a trace. This is the same principle as your brand asset generator: clean grid underneath, humanity on top.

The enemy is not perfection. The enemy is **sterility** — the feeling that no person made a decision here, that everything was set to default and nothing was chosen.

---

## Where Humanity Lives in Web Design

These are the specific places to introduce human touch. Not all of them in every project — choose the ones that are true to the context.

### 1. Typography That Breathes Unevenly
- Optical sizing over mechanical sizing. A heading that is *slightly* too large or too small for the grid — by intention — reads as a choice, not a mistake.
- Vary weight within a line when it serves meaning. Not for decoration.
- Letterspacing that tightens at large sizes (as a human would set it by hand) rather than defaulting to `0` everywhere.
- Line lengths that are chosen, not just `max-width: 65ch` applied uniformly. Some content wants to be narrow. Some wants to sprawl.
- Consider type that is occasionally **set in an unexpected axis** — rotated labels, vertical side text, text that follows the edge of a shape.

### 2. Color That Is Slightly Off
- Avoid mathematically perfect palettes. A color that is slightly warm when everything else is cool, or slightly dusty when everything else is bright, feels chosen by a person.
- Use color with restraint — then break the restraint once, deliberately, where it matters most.
- Tints and shades should feel mixed, not computed. `oklch` or hand-picked HSL values that have a small amount of hue rotation feel more alive than pure lightness steps.
- Background colors that are **not white or black** — warm off-whites (`#F7F4EF`), aged papers, cool near-whites — immediately remove the sterile feeling of a default page.

### 3. Edges and Shapes That Aren't Perfect
- `border-radius` that is non-uniform: a card with one corner more rounded than the others. Not random — *as if someone rounded it by hand and the corners came out slightly different.*
- SVG paths for dividers and section breaks instead of straight `<hr>` lines. A slightly wobbly curve, a hand-drawn-feeling wave.
- Borders that are dashed, or that stop before the corner, or that are drawn with `outline-offset` and a slight gap.
- Avoid the perfect pill button (`border-radius: 9999px`). Consider a slightly asymmetric radius, or a rounded rectangle that sits at a subtle angle.

### 4. Layout That Has Been Arranged, Not Generated
- At least one element per page that breaks the grid — not dramatically, but as if someone slid it slightly for visual balance. A pull quote that juts into the margin. An image that overlaps a section boundary. A caption that is rotated 90° beside its image.
- Asymmetric composition. Not everything centered. Not everything left-aligned. Layouts that feel like they were composed on a canvas, not flowed into a template.
- Deliberate whitespace that is *not uniform* — sections that breathe differently from each other, as if paced by feel rather than a spacing scale.
- Use `mix-blend-mode` and overlapping elements to create depth that feels layered rather than flat.

### 5. Texture as Accent
Following your brand agent's rule exactly: texture is an accent, not noise.

- A **subtle paper/grain texture** as an SVG `feTurbulence` filter or a PNG overlay at low opacity (3–8%) on backgrounds. Enough to feel like a surface, not enough to be visible as a technique.
- **Ink-on-paper feeling** for illustrated elements: slight edge softness, non-uniform fill, a hint of bleed.
- Avoid texture on text or on interactive elements — it reads as broken, not intentional.
- CSS `background-image: url("noise.svg")` or a `filter: url(#grain)` SVG filter applied to a `::before` pseudo-element keeps it separate from content.

### 6. Motion That Feels Like Weight and Material
- Elements that don't spring — they **settle**. Use `cubic-bezier(0.34, 1.4, 0.64, 1)` sparingly for a small overshoot that suggests physical mass.
- Hover states that feel like you're *touching* something: a slight press (scale down), a subtle shadow lift, a texture shift.
- Avoid choreographed stagger animations. Instead: one element loads in a way that feels like it was placed by hand — perhaps with a slight rotation that settles to 0, suggesting it was dropped rather than faded.
- Duration should be slightly longer than a digital designer would choose. 400–500ms for major transitions. It makes things feel considered rather than instant.
- **Ink-drawing reveals**: SVG `stroke-dashoffset` animation that reveals a path as if being drawn. Use for decorative elements, dividers, underlines.

### 7. Details That Only a Person Would Add
These are the things that no template would include, that make someone feel like they're on something made for them:

- A **hand-drawn underline** under a key heading (SVG `<path>` with a slightly wobbly stroke beneath the text).
- An annotation or a marginal note in a different typeface — as if someone wrote in the margin.
- A small **ink stamp**, doodle, or sketch element used as a decorative anchor (not as decoration for its own sake — as punctuation for a concept).
- **Date or edition markings** in a small monospace or typewriter face — as if the page was printed or published.
- A cursor that changes to something meaningful in context — a pencil, a pointing hand that looks drawn.
- **Smudge or bleed effects** at the edge of an image: `clip-path` with a slightly imperfect polygon, or a mask that has soft, non-circular edges.

---

## What This Is Not

This sensibility is not:

- **Retro or vintage aesthetics** — unless the content genuinely calls for it. Old-looking ≠ human-feeling.
- **Grunge or distressed design** — heavy texture, torn edges, extreme imperfection. That's a costume, not a soul.
- **Whimsy or playfulness as a default** — human-handmade can be serious, precise, and refined. A beautifully hand-lettered legal document still feels human.
- **Inconsistency for its own sake** — every "imperfection" is a choice. Nothing is broken, nothing is accidental. It just doesn't look machine-made.

---

## Per-Project Application

Because all projects should vary at the surface, here is how to apply this sensibility contextually:

| Project type | Where to apply humanist touches |
|---|---|
| Portfolio / personal site | Typography rhythm, hand-drawn accents, margin annotations |
| Product / SaaS app | Off-white backgrounds, slightly-off color palette, weight in motion |
| Editorial / blog | Optical type sizing, SVG dividers, texture on backgrounds |
| E-commerce | Material-feeling hover states, edge shapes on product cards |
| Landing page | One grid-breaking hero element, ink-reveal animation, imperfect underlines |
| Dashboard / tool | Restraint everywhere except one: color that feels chosen, not defaulted |

Apply 2–4 techniques per project. More than that and the humanity becomes the aesthetic rather than the soul.

---

## Implementation Reference

### Grain texture (CSS/SVG)
```css
/* Apply to a ::before pseudo-element, not directly to content */
.grain-surface::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: url("data:image/svg+xml,..."); /* SVG feTurbulence noise */
  opacity: 0.04;
  pointer-events: none;
  mix-blend-mode: multiply;
}
```

### Settled motion (not sprung)
```css
.card {
  transition: transform 420ms cubic-bezier(0.22, 1, 0.36, 1),
              box-shadow 420ms cubic-bezier(0.22, 1, 0.36, 1);
}
.card:hover {
  transform: translateY(-3px) rotate(-0.3deg); /* slight rotation, as if lifted by hand */
}
```

### Imperfect underline (SVG)
```html
<!-- Place absolutely under a heading, drawn by hand in the SVG editor -->
<svg viewBox="0 0 200 8" class="hand-underline">
  <path d="M0 4 C30 1, 60 7, 100 4 S160 1, 200 4"
        stroke="currentColor" stroke-width="2.5"
        fill="none" stroke-linecap="round"/>
</svg>
```

### Off-white backgrounds
```css
:root {
  --bg-paper: #F6F3EE;      /* warm aged paper */
  --bg-linen: #F4F1EC;      /* slightly cooler linen */
  --bg-plaster: #EFECE8;    /* muted, slightly grey */
}
```

### Asymmetric border radius
```css
.card {
  border-radius: 12px 14px 12px 16px; /* subtle, not wild */
}
```

---

## The Check

Before finishing any project, ask: **If someone looked at this for 10 seconds, would they feel like a person made it?**

Not "does it look handmade." Not "does it have texture." Just — does it carry the feeling that someone was here, making choices, caring about this specific thing?

If yes: done.
If no: find the one place where the machine is most visible and replace it with a decision.