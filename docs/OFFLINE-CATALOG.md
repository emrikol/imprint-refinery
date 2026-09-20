# Offline catalog

Imprint Refinery ships a local, read-only Flipper-IRDB catalog. Normal search
and profile access do not use the network. The catalog keeps each upstream
`.ir` document byte-for-byte, while its small manifest normalizes category,
brand, model, remote-model, alias, and command labels for search.

## Source and license

The source lock is [`catalog-sources.json`](../catalog-sources.json). It pins:

- Flipper-IRDB revision
  `d126fb1b6f1e114c52b4a8c19839ea65e3a9c24d`;
- the repository URL and attribution;
- its CC0-1.0 license and exact license-file SHA-256;
- a SHA-256 over every ingested relative path and byte.

The artifact includes the matching license text. The tree hash also supports a
local source snapshot without `.git`; a changed file, path, license, or revision
stops the build.

## Rebuild

Checkout the pinned revision outside the public source tree, then run:

```bash
python3 tools/build_catalog.py --source-root /path/to/Flipper-IRDB
```

This regenerates:

- `custom_components/imprint_refinery/catalog-v1.ircat`;
- `custom_components/imprint_refinery/catalog-v1.ircat.sha256`;
- `catalog/coverage.json` and `catalog/COVERAGE.md`.

ZIP entry names, metadata, JSON ordering, source traversal, and timestamps are
fixed, so repeating a build from the locked source produces the same artifact.
Malformed or incomplete files are quarantined with their reasons rather than
silently repaired. Updating the catalog requires an explicit new revision,
license hash, tree hash, and catalog version in the source lock.

## Runtime shape

The integration loads only `manifest.json` for search. Opening a result reads
that one original `.ir` document from the artifact. Exact signal matching loads
the compact `matches.json` lookup on first use; it does not scan profile files.
This avoids loading the entire command corpus into memory.
`catalog_artifact.OfflineCatalog` exposes `status()`, `search()`,
`get_profile()`, and `match()` for the integration service layer.

The bundled catalog currently contains only Flipper-IRDB. Additional sources
can be added later without introducing a network or account dependency into
normal Home Assistant use.
