# Non-production code areas and build channels

This directory holds code that ships only in **some** build channels — the
TypeScript equivalent of a C `#ifdef`, except the excluded code is genuinely
absent from the shipped bundle and VSIX rather than merely disabled at
runtime.

## Channels

`development` (default for source builds) → `internal` → `insiders` →
`stable`. The channel is chosen at build time:

```
MSSQL_BUILD_CHANNEL=stable npm run build            # env var, any entry point
node scripts/bundle-extension.js --channel=stable   # explicit argument
node scripts/package-extension.js --channel=stable  # packaging (must match the bundle)
```

Plain local builds default to `development`, which includes everything, so
day-to-day work and unit tests never notice the mechanism: `tsc` compiles all
sources for `out/` regardless of channel (tests run against `out/`, not the
bundle), and only the esbuild bundle — the only code a VSIX ships — is
channel-filtered.

## How exclusion works

1. Each area lives in `src/nonproduction/<area>/` and declares its channels
   in [`channels.json`](./channels.json).
2. An area has exactly one sanctioned import seam: its `index.ts`. Production
   code imports the area **only** through that seam. A twin `index.stub.ts`
   exports the same surface as inert no-ops.
3. `scripts/build-channels.js` provides an esbuild plugin that, for excluded
   areas, resolves the seam to the stub — so esbuild never visits the area's
   sources — and rejects any deep import into an excluded area from outside.
4. After bundling, the plugin audits the esbuild metafile: if any excluded
   source slipped into the bundle, the build fails. The bundle records its
   channel in `dist/build-channel.json`.
5. Packaging (`scripts/package-extension.js`) reads that record, refuses a
   channel mismatch, strips the area's `package.json` contributions (settings,
   commands, palette entries, language-model providers) as listed in
   [`manifest-contributions.json`](./manifest-contributions.json) for the
   VSIX, and restores the manifest afterwards.

`test/unit/nonproductionChannels.test.ts` pins the invariants: every area has
both seam files with matching export surfaces, channel lists are valid, and
every manifest contribution in the map still exists in `package.json`.

## Adding a new gated area

1. Create `src/nonproduction/<area>/` with the implementation, an `index.ts`
   seam exporting the minimal composition surface (usually one `register…`
   function), and an `index.stub.ts` with the identical export names as
   no-ops.
2. Add the area to `channels.json` with its channel list.
3. If the area contributes to `package.json`, list those contributions in
   `manifest-contributions.json`.
4. Import the area from production code only via
   `.../nonproduction/<area>` (the seam). Keep runtime feature gates too —
   channel exclusion is a shipping boundary, not a substitute for the
   private-preview settings gates in included channels.

## Current areas

- **sdkLanguageModels** — direct Anthropic/OpenAI/xAI SDK language-model
  providers for internal model testing (`development`/`internal`/`insiders`
  only). Stable ships Copilot-based models exclusively; shipping direct
  API hooks externally requires separate security/compliance review. The
  shared model-selection/display code and the Copilot path live in
  production (`src/copilot/…`) and are unaffected.
