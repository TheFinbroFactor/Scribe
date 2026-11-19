# StudentOS — split project

This version keeps the StudentOS code separated for easier customisation while using a generated `js/app.js` bundle at runtime. This preserves the original JavaScript module scope and avoids the startup problem caused by loading the pieces as separate classic scripts.

## Structure

```text
StudentOS/
├── index.html
├── build.py
├── build.bat
├── README.md
├── css/
│   └── styles.css
└── js/
    ├── 01-config.js      # Firebase/config/constants
    ├── 02-utils.js       # Helpers, icons, utilities
    ├── 03-services.js    # Firebase, Google, storage, syncing
    ├── 04-views.js       # Pages and charts
    ├── 05-ui.js          # UI, events, modals, auth UI
    ├── 06-main.js        # Startup/boot
    └── app.js             # Generated runtime bundle — do not edit directly
```

## After changing the code

Edit the numbered files, then run:

```text
build.bat
```

or:

```text
python build.py
```

This regenerates `js/app.js`. Then refresh StudentOS.

## Main customisation points

- **Appearance:** `css/styles.css`
- **Firebase/settings:** `js/01-config.js`
- **Reusable logic:** `js/02-utils.js`
- **Data + Google/Firebase syncing:** `js/03-services.js`
- **Pages/dashboard:** `js/04-views.js`
- **Buttons/modals/interactions:** `js/05-ui.js`
- **Startup:** `js/06-main.js`
