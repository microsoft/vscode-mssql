# T-SQL corpus resources

These SQL files provide broad, offline parser coverage for the unit tests. `manifest.json` records
the encoding and expected classification of each file. `baseline.json` records the maximum accepted
Lezer recovery-node count for every parseable file.

Run `npm run test:unit` to validate the corpus with the rest of the unit suite. Use
`npm run report:corpus` to inspect parser coverage, and update the baseline only after reviewing an
intentional parser change.
