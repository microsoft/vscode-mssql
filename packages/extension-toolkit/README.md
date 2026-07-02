# Extension Toolkit

Reusable building blocks for VS Code extensions in this repository.

The package has two public layers:

- `extension-toolkit/base`: VS Code-independent primitives.
- `extension-toolkit/vscode`: VS Code extension-host services.

Do not import from the package root. Use an explicit layer import instead.
