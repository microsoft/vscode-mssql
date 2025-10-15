## Code Formatting

### Steps to Update Rules

1. Update config files
2. Mass-apply config changes using the CLI method (see table below for usage)
3. Commit changes and send for PR
4. After that PR is merged, add its commit hash to `.git-blame-ignore-revs` so that `git blame` ignores mass-formatting commits and instead focuses on "real" changes

### Config Locations

Code formatting is done via Prettier, but that can be triggered in several different ways and each has its own config location.

> 👉 Update _all_ locations when changing formatting rules.

| File                    | Function                                                        | How to Use                                                                                    |
| ----------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `prettier.config.mjs`   | used by the command-line `prettier` command for bulk formatting | `npm install -g prettier`<br /> `prettier "**/*.ts" [--write \| --check]`                     |
| `.vscode/settings.json` | used by VS Code's Prettier extension                            | Install Prettier extension (`esbenp.prettier-vscode`), then run the "Format Document" command |
| `eslint.config.mjs`     | used by Git's precommit ESLint checks                           | Automatically run when creating a commit                                                      |

ß
