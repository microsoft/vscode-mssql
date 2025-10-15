# T-SQL Grammar

This grammar is for the [T-SQL (Transact-SQL)](https://learn.microsoft.com/sql/t-sql/language-reference) language. While it may share many common language elements with other SQL-based languages, its primary purpose is to support the T-SQL Language and as such may include or not include syntax from other languages.

## Syntax Highlighting

Azure Data Studio and VS Code use this grammar to provide syntax highlighting - the color and style of source code - in their respective editors. You can read more about how this is done [here](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide)

Each token defined in the grammar is then given a color based on the current theme, matching as specific of a token name as possible. For example, `keyword.other.sql` and `keyword.other.create.sql` can be different colors if there's a `tokenColors` setting defined for them specifically. But if not then they will try to match more general scopes - which in the typical case is going to have both resolve to the `keyword` scope.

Because of this, generally tokens are expected to be colored based on the top level scopes (such as `keyword`), with the more specified scopes being used mostly for readability and allowing customers the ability to create custom colors for just a subset of keywords if they wish. But since the color themes will generally not include colors for these tokens they will inherit from the top-level scope by default.

You can see the colors used in the default themes for VS Code and Azure Data Studio [here](https://github.com/microsoft/vscode/tree/main/extensions/theme-defaults/themes).

### Where should I add a new keyword?

For general T-SQL keywords the most common place they will go is the huge regex for `keyword.other.sql`. This means that ANY time this keyword shows up outside of certain special circumstances it will be colored as a keyword. This is often "good enough", although you are also free to add your own match section with a more complex regex if you wish.

## Updating the grammar

### VS Code

First we'll update the grammar in VS Code, which is done through updating the grammar directly in this repo. Once a month VS Code will pull in the latest changes into the [grammar file in its repo](https://github.com/microsoft/vscode/blob/main/extensions/sql/syntaxes/sql.tmLanguage.json).

1. Once you've made your changes to the grammar file, build & run this extension locally (see the [wiki](https://github.com/microsoft/vscode-mssql/wiki/testing-and-debugging#debugging-extension-side-code)) to verify that the colors show up as you expect in a new query editor (`MS SQL: New Query` command)
2. Now submit a PR, making sure to include a screenshot of the colors

### Azure Data Studio

1. After the PR in this repo is merged, clone the [Azure Data Studio](https://github.com/Microsoft/azuredatastudio) repo
2. cd to `extensions` and run `yarn install`
3. Run the following commands to regenerate the grammar file

```powershell
cd extensions/sql/build
npm run update-grammar
```

3. Send out a PR with the changes made to any files that were modified, making sure to link to the original PR in this repo where the changes were made

_Note_: You can test Azure Data Studio locally by building and running it and verifying the colors are correct in a new editor window
