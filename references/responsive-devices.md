# Responsive Device Presets

Use these viewport presets when running responsive QA tests.

| Device | Width | Height | Scale | Mobile |
|--------|-------|--------|-------|--------|
| iPhone SE | 375 | 667 | 2 | Yes |
| iPhone 14 Pro | 393 | 852 | 3 | Yes |
| Samsung Galaxy S21 | 360 | 800 | 3 | Yes |
| iPad | 768 | 1024 | 2 | Yes |
| iPad Pro | 1024 | 1366 | 2 | Yes |
| Desktop | 1440 | 900 | 1 | No |
| Desktop HD | 1920 | 1080 | 1 | No |

## Checks Per Viewport

For each viewport, verify:
- No horizontal scroll (content <= viewport width)
- All text readable (body font >= 16px on mobile, >= 12px on desktop)
- Touch targets >= 44x44px on mobile devices
- No media query gaps (elements don't disappear between breakpoints)
- Navigation menu accessible (hamburger if used, touch-friendly)
- Images don't overflow containers
- Forms usable (inputs visible, keyboard doesn't obscure)
