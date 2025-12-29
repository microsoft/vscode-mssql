# Connection Sharing Sample Extension

A VS Code extension that demonstrates how to use the **MSSQL Extension's Connection Sharing API** to interact with SQL Server databases from within your own extensions.

## 📋 Overview

This sample extension showcases two different approaches to leverage database connections established by the MSSQL extension:

1. **Command-based approach** - Using VS Code's command execution system
2. **Direct API approach** - Using the MSSQL extension's exported API directly

## To run:

1. Compile the mssql extension by running from the repository root:

```bash
yarn
yarn watch
```

2. Open this sample extension in VS Code
3. In the Run and Debug view, select the "Run Extension" configuration
4. It should launch a new VS Code window with the extension activated

## 🆘 Support

If you encounter any issues or have questions, please open issues on Github.
