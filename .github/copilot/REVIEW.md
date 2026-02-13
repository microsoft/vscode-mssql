This is a list of instructions for providing helpful and relevant comments while reviewing code. Use these in addition to standard good practices while code and the AGENTS.md files closest to each file.

# Backend code

- DO check for places where an identity for a connection is used other than its ID.

# UIs

- DO check for direct use of a state object instead of selectors
- DO check for instances where a selector is only passed as a property to other components, and it should be pushed down.

## Code Health

- DO check for duplicated code when we already functions somewhere
- DO NOT writing custom functions when a library is already used in the extension (or part of the node runtime) to perform that function

## Tests

- DO check for stubs that are constructed manually instead of loosely-defined objects of stubs
- DO check for places where stubs are created outside of a sandbox.
- DO check to make sure that the shared sinon stubs are used wherever possible, and that good candidates are added to the collection of premade stubs.
- DO check to make sure that stubs and verifications that are accessed multiple times within a test check using parameters and not by "n-th call". This is brittle logic and easily broken.

## Localization

- DO check for strings in UIs and user-facing messages that should be localized.
- DO check for duplication of strings within localization constants files, and suggest good candidates for moving to the "common" bundle.
- DO NOT comment on presence, lack of presence, or correctness of translations inside localization files. Those are handled in a separate process outside of our normer reviews.
