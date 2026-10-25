# JSON community layer

The active architecture is documented in [CONTRIBUTING.md](../CONTRIBUTING.md).
It preserves the national fullscreen viewer and implements a deliberately bounded
community overlay with individual editable JSON records, stable IDs, parent-hash
conflicts, tombstones, provenance, a browser proposal editor, GitHub admin review,
and deterministic static publication. Accepted records are searchable independent
of the viewport; point records can be routing endpoints. Non-point search results
fit their geometry and open the editor; no representative route point is invented.

There is no separate admin account service. GitHub's maintainers/reviews/branch
rules provide access control. No browser token writes to the repository. Downloading
JSON does not submit it. GitHub's UI handles authenticated branch/PR creation.

Overture replacement, nationwide address search, multiuser live editing, dynamic
routing graph updates and new hosting are outside this bounded implementation.
Source-ID and upstream-refresh checks must precede enabling baseline replacements.
Restoring the historical canonical stack wholesale would also restore a different
viewer/offline/pilot architecture; this implementation reuses its lifecycle ideas
without overwriting the current fullscreen application.
