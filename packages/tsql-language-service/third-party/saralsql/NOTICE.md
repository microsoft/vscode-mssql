# SaralSQL parser provenance

The source under `src/parser/saral` and the corresponding tests under
`test/parser` are derived from `@saralsql/tsql-parser` 0.4.7:

- Upstream repository: https://github.com/saralstalin/saralsqlparser
- Upstream commit: `e95951c1ba48c41c026a1244ac23cedc2ced7fb7`
- Copyright: Copyright (c) 2026 Saral Simon Stalin
- License: MIT; see [LICENSE](./LICENSE)

The source was vendored on 2026-08-09. Generated JavaScript, declaration
files, source maps, package metadata, benchmarks, and compiled test artifacts
were intentionally excluded. Relative source imports were adapted to strict
ESM/NodeNext conventions without changing parser behavior. Test imports were
adjusted for the vendored layout, and the upstream cross-validation test was
changed to exercise the local TypeScript source instead of an upstream `dist`
directory.

Local changes to the vendored implementation should retain this notice and
the accompanying MIT license.
