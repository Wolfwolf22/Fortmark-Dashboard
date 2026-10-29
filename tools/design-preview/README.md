# FortMark design preview

This isolated local harness renders the production `AppShell`, `TopBar`, Home
components, widgets and shared controls against synthetic, clearly labelled data.
It does not add a production route or bypass authentication. All fetch calls are
intercepted locally, all writes are rejected, and layout changes are memory-only.
The profile and creation dialogs are explicit preview-only placeholders.

Run from the repository using Node 22 or later:

```sh
node tools/design-preview/server.mjs
```

Open `http://127.0.0.1:4173/preview`. The server rebuilds the real component
bundle and Tailwind styles on page reload. Use the existing theme control for
light/dark, Settings for foundations, and browser width for responsive review.
No extra dependencies, accounts or environment secrets are required.

For deterministic phone/tablet/desktop review, open
`http://127.0.0.1:4173/responsive?width=390`. Its same-origin iframe gives the
real app a 320, 390, 768, 1280 or 1440 px viewport without relying on the
browser's viewport override capability.

The Home metrics resemble an early-stage workspace: two sample active deals,
$12.8K pipeline, missing commission terms, and one represented sample client.
No live feed is connected, so the real featured-listing component keeps its
honest unavailable state. This is a visual review, not a workflow certification.
