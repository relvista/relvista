---
'@relvista/renderer': patch
---

`DbmlViewer` no longer ships `react-dom/server` (about 60 KB gzip): the canvas writes its SVG export with the browser's serialiser (the same drawing; attributes are spelled as the browser writes them). The PDF dialog loads when it first opens, the PDF writer on export.
