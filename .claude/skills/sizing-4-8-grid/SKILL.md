---
name: sizing-4-8-grid
description: Apply the 4px/8px sizing system to any UI work — layouts, components, Figma frames, CSS, design tokens, or design reviews. Use whenever choosing a size, spacing, padding, margin, gap, or line height, or when auditing a design for off-grid values.
---

# 4px / 8px Sizing System

## Core rule

- **8px is the default unit.** Use it for layout, component sizes, and spacing between components.
- **4px is the fine unit.** Use it only inside components: icons, type, line heights, and tight internal gaps.
- **Never use a value that is not a multiple of 4.** No 5, 10, 15, 18, 30px.

Sources: Material Design says all components align to an 8dp grid, and icons, type, and some elements inside components can align to a 4dp grid. Android's design guide gives the same split and says to stick to measurements of 4 and 8.

## Scale

| Token        | px  | rem   | Typical use                                   |
|--------------|-----|-------|-----------------------------------------------|
| `space-0`    | 0   | 0     | Reset                                         |
| `space-0.5`  | 4   | 0.25  | Icon-to-label gap, tight inline gap           |
| `space-1`    | 8   | 0.5   | Default small gap, list item internal gap     |
| `space-1.5`  | 12  | 0.75  | Button vertical padding, input vertical padding |
| `space-2`    | 16  | 1     | Screen edge margin (mobile), card padding (compact) |
| `space-3`    | 24  | 1.5   | Card padding, gap between related groups      |
| `space-4`    | 32  | 2     | Gap between components                        |
| `space-5`    | 40  | 2.5   | Large component gap                           |
| `space-6`    | 48  | 3     | Gap inside a section                          |
| `space-8`    | 64  | 4     | Gap between sections (desktop)                |
| `space-12`   | 96  | 6     | Major section spacing, hero padding           |

Token name = multiplier of 8. `space-0.5` = 4px, `space-3` = 24px. This makes the math obvious in code and in Figma.

Rem values assume a 16px root.

## Decision logic

Run this check for every value:

1. **Is it spacing or size between or of components?** → Use a multiple of 8.
2. **Is it inside a component (icon, text, internal padding)?** → A multiple of 4 is allowed.
3. **Is it a line height or text box?** → Use a multiple of 4. Example: 14px text → 20px line height; 16px → 24px; 20px → 28px.
4. **Is it a stroke or border?** → 1px or 2px is allowed. Borders do not count against the grid. Do not add the border to the component height (a 40px button stays 40px with or without a border; use inside strokes in Figma).
5. **Is it a type size?** → Font size can be off-grid (e.g. 14px, 18px). The **line height** must be on the 4px grid.
6. **Does content force an off-grid value?** → Fix the container, not the content. Round the container up to the next multiple of 4 (inside) or 8 (outside).

## Proximity rule

Space shows grouping. Related items get less space than unrelated items.

- Inside a group: 4–8px
- Between groups in a component: 12–16px
- Between components: 24–32px
- Between sections: 48–96px

Each level should be clearly bigger than the level below it. If two levels look the same, step up one token.

## Component defaults

| Component          | Height        | Padding (V / H) |
|--------------------|---------------|-----------------|
| Button (small)     | 32px          | 4 / 12px        |
| Button (default)   | 40px          | 8 / 16px        |
| Button (large)     | 48px          | 12 / 24px       |
| Input              | 40px          | 8 / 12px        |
| List item (1 line) | 48px or 56px  | 8 / 16px        |
| Icon               | 16, 20, 24px  | —               |
| Touch target       | min 48px      | —               |

Material's touch target minimum is 48dp. Apple's is 44pt — if the product is iOS-native, use 44 and accept this one exception.

## In Figma

- Set nudge amount to 8px (Preferences → Nudge amount: small 4, big 8 is a common setup).
- Add a layout grid: 8px square grid on frames.
- Create number variables for each token. Bind auto layout padding and gap to variables. Never type raw numbers.
- Frame heights: snap to multiples of 8.

## In CSS

```css
:root {
  --space-0: 0;
  --space-0_5: 0.25rem; /* 4px */
  --space-1: 0.5rem;    /* 8px */
  --space-1_5: 0.75rem; /* 12px */
  --space-2: 1rem;      /* 16px */
  --space-3: 1.5rem;    /* 24px */
  --space-4: 2rem;      /* 32px */
  --space-5: 2.5rem;    /* 40px */
  --space-6: 3rem;      /* 48px */
  --space-8: 4rem;      /* 64px */
  --space-12: 6rem;     /* 96px */
}
```

Enforce with the `stylelint-8-point-grid` plugin. Set `base: 4` so 4px steps pass, and allowlist `1px` and `2px` for borders.

## Review checklist

When auditing a design or code:

- [ ] Every spacing value is a multiple of 4.
- [ ] Every value between components is a multiple of 8.
- [ ] Every line height is a multiple of 4.
- [ ] Component heights are multiples of 8 (4 allowed only for small elements like chips or tags).
- [ ] Borders do not change component height.
- [ ] Spacing grows with grouping level (proximity rule holds).
- [ ] Values come from tokens, not raw numbers.
- [ ] Touch targets are at least 48px (44px on iOS).

Report each violation as: element → current value → corrected value → reason.

## Common mistakes

- **10px / 20px padding.** Comes from web habit. Use 8/12 or 16/24.
- **Odd line heights** like 1.5 × 14 = 21px. Round to 20px.
- **Borders added on top of height.** A 40px input becomes 42px. Use inside strokes or `box-sizing: border-box`.
- **Mixing 4 and 8 at the layout level.** A 4px gap between two cards looks like a mistake, not a choice.
- **Too many tokens.** If you need 36px, check if 32 or 40 works first. Each extra step weakens the system.

## Sources

- Material Design — Spacing methods: https://material.io/design/layout/spacing-methods.html
- Android Developers — Grids and units: https://developer.android.com/design/ui/mobile/guides/layout-and-content/grids-and-units
- Material Design (v1) — Metrics & keylines: https://m1.material.io/layout/metrics-keylines.html
- Workday Canvas — Space tokens: https://canvas.workday.com/styles/tokens/space
- B.C. Design System — Layout: https://www2.gov.bc.ca/gov/content/digital/design-system/foundations/layout
- stylelint-8-point-grid: https://www.npmjs.com/package/stylelint-8-point-grid
