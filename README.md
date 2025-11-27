# Twitter User Notes (Chrome extension)

Add personal notes next to Twitter/X users directly in the timeline, and manage everything from a polished popup and options page. The project follows the system design in `design.md` and ships TypeScript sources plus pre-built JavaScript so you can load the unpacked extension immediately.

## Features
- Inline note pill and edit icon injected into each tweet (`article[data-testid="tweet"]`) with MutationObserver support for infinite scroll.
- Prompt-based editing in the timeline; empty input deletes the note.
- Storage wrapper prefers `chrome.storage.sync`, with a one-click option to force local-only storage plus automatic fallback if sync is unavailable.
- Popup: search, inline edit/cancel, delete, quick-add, JSON import/export, relative timestamps, modern styling.
- Options page: switch storage preference, export/import, clear all notes, and view totals.

## Project structure
```
manifest.json
src/
  content-script.ts       // DOM parsing + inline note UI
  popup/popup.ts          // popup logic
  options/options.ts      // options page logic
popup/
  popup.html
  popup.css
options/
  options.html
  options.css
dist/                     // prebuilt JS consumed by manifest/pages
tsconfig.json
package.json
design.md
```

## Building (TypeScript → dist)
Prebuilt JS already lives in `dist/`. If you edit the TypeScript, rebuild with:
```
npm install
npm run build
```
`tsc` outputs to `dist/` as configured in `tsconfig.json`.

## Load the extension
1) Open `chrome://extensions` → enable **Developer mode**.  
2) Click **Load unpacked** and select this project root.  
3) Navigate to twitter.com or x.com; the 📝 control and note pill appear beside usernames.  
4) Use the toolbar icon to open the popup for search/edit/import/export. The options page is available via the extension’s “Details” → “Extension options”.

## Storage behavior
- Default: `chrome.storage.sync` with automatic fallback to `chrome.storage.local` if sync writes fail.
- Options page toggle “Store notes locally only” flips the preferred storage to local (and persists your current cache there).

## Development notes
- DOM targeting favors `article[data-testid="tweet"]` and profile links that match `/^/[A-Za-z0-9_]{1,15}$/` to reduce false positives.
- Each processed tweet is marked with `data-xtag-enhanced` to avoid duplicate injections; notes update live when storage changes.
- Styling lives in content-script-injected CSS plus scoped styles for popup/options; adjust in the corresponding CSS files.

## Future extensions
Tags, advanced popovers, export/import UX, user ID binding, and cross-browser support can be layered on top of the current storage and UI scaffolding.
