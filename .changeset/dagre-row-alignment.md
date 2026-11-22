---
'@relvista/core': minor
---

The dagre layout (`layoutDiagramSync`, and `engine: 'auto'` for small parts of a schema) now lines up the key and foreign-key rows each ref joins, left to right, and `engine: 'auto'` keeps connected components of up to 4 tables on dagre (`AUTO_DAGRE_MAX_NODES`, was 3).
