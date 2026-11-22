---
'@relvista/docusaurus-plugin': patch
---

Pages without diagrams no longer load any diagram code, not even through Docusaurus' prefetch of links to diagram pages: a page with a ` ```dbml ` or ` ```dbml-diff ` fence loads the diagram component itself before it renders (a small webpack loader), and the theme code is never part of a page's own chunk.
