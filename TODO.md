# NeuroFlor — Implementation TODO

## Tasks

- [x] 1. Add mindfulness slider HTML to `app/index.html` (inside `capture-live`, above status bar)
- [x] 2. Add tour overlay HTML to `app/index.html` (outside `#root`, before scripts)
- [x] 3. Add CSS styles for mindfulness slider to `app/style.css`
- [x] 4. Add CSS styles for interactive tour to `app/style.css`
- [x] 5. Implement mindfulness slider JS logic in `app/app.js` (rotating messages, progress bar)
- [x] 6. Implement interactive tour JS logic in `app/app.js` (steps, spotlight, navigation, localStorage)
- [x] 7. Fix garden auto-refresh: set `gardenLoaded = false` in `showResults()` in `app/app.js`
- [x] 8. Add post-capture tour steps guiding user to "Ver Flor" button
- [x] 9. Call `stopMindfulness()` on capture stop and auto-finish; call `startMindfulness()` on polling start

## Summary of Changes

### `app/index.html`
- Added `#mindfulness-slider` section inside `#capture-live` (above `live-status-bar`)
- Added `#tour-overlay` with backdrop, spotlight, and tooltip (outside `#root`)

### `app/style.css`
- Added `.mindfulness-slider` styles with shimmer animation, breathing icon, text fade, progress bar
- Added `.tour-overlay`, `.tour-backdrop`, `.tour-spotlight`, `.tour-tooltip` styles with pulse, fade-in animations

### `app/app.js`
- **Garden fix**: `gardenLoaded = false` in `showResults()` ensures garden reloads after capture
- **Mindfulness**: 15 rotating calming messages, 6s interval, animated progress bar (timed or oscillating)
- **Tour system**: Step-based with spotlight highlighting, prev/next/skip navigation, localStorage persistence
- **Setup tour**: 5 steps (welcome, name, duration, start button, OSC config) — auto-starts on first visit
- **Post-capture tour**: 2 steps (completion message, guide to "Ver Flor") — shown after every capture
