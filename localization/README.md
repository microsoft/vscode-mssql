# Localization

The extension has 2 main ways to localize the strings in the UI.

## 1. Static contributions in `package.nls.json`

The extension utilizes the package.nls.json file to localize strings within the contributions specified in the package.json file. This package.nls.json file is a straightforward JSON file that maps keys to their corresponding localized strings.

Example of `package.nls.json`

```json
{
  "mssql.key1": "Localized string 1",
  "mssql.key2": "Localized string 2"
}
```

Using in `package.json` to contribute to vscode extensibility points. For example: commands

```json
{
  "commands": [
    {
      "command": "mssql.testCommand",
      "title": "%mssql.key1%",
      "icon": "$(debug-start)"
    }
  ]
}
```

## 2. Dynamic contributions in `*.ts` and `*.tsx` files

### Extension Code (excluding React webviews):

If you need to localize strings in the extension code, you can use the directly use the l10n api provided by vscode. To read more the l10n api, please refer to the [official documentation](https://code.visualstudio.com/api/references/vscode-api#l10n)

```ts
import { l10n } from 'vscode';

const test = l10n.t('Test loc');
```

After adding a new string to localize, you need to run `yarn localization` to update the xlf and l10n files.


### React webviews:

Since webviews do not have access to the vscode API, we need to use `@vscode/l10n` library to localize strings in the React components.

```ts
import * as l10n from '@vscode/l10n';

const test = l10n.t(`Test loc`);
```

After adding a new string to localize, you need to run `yarn localization` to update the xlf and l10n files.
NOTE: Please follow the exact syntax `l10n.t(<loc string>)` otherwise the localization extraction will not work.
So things like this won't work.
```ts
import * as l10n from '@vscode/l10n';
const { t } = l10n;
const test = t(`Test loc`);
```


## Localization Process Overview

### Step 1: Extracting Localization Strings
1. Run the command `yarn localization`.
2. This triggers a task that scans all the source files for both the extension and webview.
3. It extracts all `l10n.t` function calls and compiles them into a `bundle.l10n.json` file located in the `localization\l10n` folder.
4. The task then reads this `bundle.l10n.json` file, along with the `package.nls.json` file, and updates the `enu.xliff` file found in the `localization\xliff` folder.

### Step 2: Translating the XLIFF File
- The `enu.xliff` file is sent to translators for translation.
- After translation, the translated XLIFF files are placed back in the `localization\xliff` folder.

### Step 3: Generating Localization Files
1. As a part of build process we run `yarn build:runtime-localization`.
2. This task reads the translated XLIFF files and generates localized JSON files:
   - `bundle.l10n.{locale}.json` files are saved in the `localization\l10n` folder.
   - `package.nls.{locale}.json` files are saved in the root folder.

### Step 4: Using the Localization Files
- The extension uses these generated JSON files to localize the strings in the user interface (UI). The root of the l10n is provided in the `package.json` file with `l10n` key. For now it is set to `localization/l10n`.