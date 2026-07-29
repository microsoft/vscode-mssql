# Extension Toolkit

Reusable building blocks for VS Code extensions in this repository.

The package has three public entry points with a one-way dependency direction:

- `extension-toolkit/base` contains portable primitives. It must not import the
  `vscode` module or anything from the toolkit's `vscode` layer so it remains
  usable outside the VS Code extension host.
- `extension-toolkit/vscode` contains shared extension-host services and may
  depend on `base`, the VS Code API, and VS Code-dependent libraries. Shared
  helpers such as telemetry integrations belong in this layer.
- `extension-toolkit/vscode/testing` contains test fakes and utilities. It may
  depend on either production layer, but production code must not import it so
  test-only behavior is not included in the shipped runtime.

Do not import from the package root. Use an explicit layer import instead.
