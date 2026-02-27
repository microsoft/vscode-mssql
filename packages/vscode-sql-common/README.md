# @microsoft/vscode-sql-common

Shared utilities for SQL vs code extensions coordination.

## Overview

This package provides shared infrastructure for SQL extensions in vscode.

### URI ownership

Coordinates SQL file ownership across extensions so only the owning extension shows SQL-specific UI/actions. See [src/uriOwnership/README.md](src/uriOwnership/README.md) for details.

## Installation

### Consume within the vscode-mssql monorepo

Reference the local package:

```json
{
    "dependencies": {
        "@microsoft/vscode-sql-common": "file:../vscode-mssql/packages/vscode-sql-common"
    }
}
```

External consumption guidance is coming soon.

## License

MIT
