# StudentOS — split version

This version keeps the existing StudentOS code and separates it into independently editable files.

## Structure

- `index.html` — page structure / HTML
- `css/styles.css` — all styling, colours, spacing, responsive rules
- `js/01-config.js` — Firebase config, app constants, subject aliases
- `js/02-utils.js` — reusable utility/helper functions
- `js/03-services.js` — Firebase, Google services, data store, syncing and app state
- `js/04-views.js` — charts and page rendering
- `js/05-ui.js` — event handling, modals, PDF parsing, diagnostics, auth UI
- `js/06-main.js` — startup / boot sequence

The JavaScript files are loaded in dependency order as regular scripts so the existing code can continue to share its functions and state without a framework or build step.

## Customisation

For visual changes, start with `css/styles.css`.

For Firebase/API/app settings, use `js/01-config.js`.

For changing page layouts, use `js/04-views.js`.

For changing buttons, interactions and modal behaviour, use `js/05-ui.js`.

For startup behaviour, use `js/06-main.js`.
