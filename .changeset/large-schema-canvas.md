---
'@relvista/renderer': patch
---

Faster interaction with very large diagrams in `DiagramCanvas` and `DbmlViewer`: when a new model arrives (an edit), only the tables and ref lines that changed are drawn and measured again, hovering a table no longer redraws every dimmed card, and dragging a table costs less per frame. In the relvista editor, a keystroke in a 600-table schema now reaches the diagram about a quarter sooner (≈ 1.0 → 0.76 s, most of the rest is parsing). Drawings and exports are unchanged.
