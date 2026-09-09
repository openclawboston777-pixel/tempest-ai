# Tempest AI — Ema Widget (Slice 1)

An embeddable, framework-free storefront chat assistant. All UI is encapsulated in
a Shadow DOM so host-page styles never leak in or out. It renders a coral assistant
bubble that opens a floating chat panel and streams replies from your backend over SSE.

## Requirements

- Node 18+
- A backend exposing `POST {backendUrl}/chat` that responds with a Server-Sent
  Events stream of lines like:
  ```
  data: "Hello"
  data: " there"
  data: [DONE]
  ```
  Each `data:` payload (except `[DONE]`) is a JSON-encoded string delta.

## Configure

Set the global config before the widget loads:

```html
<script>
  window.TempestConfig = {
    backendUrl: "http://localhost:8080",
    assistantName: "Ema"
  };
</script>
```

Defaults: `backendUrl = "http://localhost:8080"`, `assistantName = "Ema"`.

## Develop

```bash
npm i
npm run dev
```

Open the printed local URL. `index.html` is a fake storefront dev harness with the
widget mounted in the corner.

## Build

```bash
npm run build
```

Produces a single self-executing bundle at `dist/tempest-widget.iife.js`
(CSS is inlined into the bundle and injected into the shadow root).

## Embed

Add the config, then load the built bundle anywhere on your page (ideally before
`</body>`):

```html
<script>
  window.TempestConfig = {
    backendUrl: "https://api.yoursite.com",
    assistantName: "Ema"
  };
</script>
<script src="/path/to/tempest-widget.iife.js"></script>
```

The widget self-initializes on load, appends its own host element to `<body>`, and
attaches an open shadow root. No further wiring required.

## Notes

- The "Talk to me" (mic) button is **visual only** in this slice — a TODO marks
  where voice interaction will be wired up later.
- Conversation state is kept in memory for the session only.
- The panel is a floating card (desktop) / bottom sheet (mobile). There is no
  full-screen takeover and no page-dimming overlay — the storefront stays usable.
