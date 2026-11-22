---
'@relvista/renderer': minor
---

PDF export: Greek, Cyrillic, Chinese and Japanese text stays selectable, searchable text instead of turning the page into an image. The PDF embeds a subset of Noto Sans (SIL OFL 1.1) or of a CJK font built from Droid Sans Fallback (Apache 2.0); the fonts load only when a diagram needs them. Arabic, Hebrew, Hangul, Indic scripts and emoji still export as images. New: the `embedFonts` option of `exportPdf` (default true; `false` keeps the 1.0 behaviour) and `pdfCanDrawText(text)`.
