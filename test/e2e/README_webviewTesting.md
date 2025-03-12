## Coverage Commands

### Prerequisites

- [Node.js](https://nodejs.org/en/) v18 or higher
- [yarn](https://yarnpkg.com/) v1.22.0 or higher, `npm install -g yarn`
- [nyc](https://www.npmjs.com/package/nyc) v17.1.0 or higher, `npm install -g nyc`

The first time you run this, you need to instrument the built project so that coverage data is picked up during testing.

Within the vscode-mssql repo, after you've already build the project, run

```shell
nyc instrument ./out/src ./out/src --in-place --exclude=**/views/htmlcontent/**
```

If you get a memory error while instrumentation, run this
```shell
$env:NODE_OPTIONS="--max-old-space-size=8192"
```
then rerun the instrumentation

After the code is instrumented run the tests using
```shell
npx nyc --reporter=html --reporter=text-summary --include="src/reactviews/pages/**/*.tsx" npx playwright test
```

To pick up coverage data while testing, you have to run the instrumentation command every time you rebuild the project.

However, if you've only changed the tests, then you can run

```shell
gulp ext:compile-tests; npx nyc --reporter=html --reporter=text-summary --include="src/reactviews/pages/**/*.tsx" npx playwright test
```

This will recompile your tests and run them for coverage.

## Playwright Testing within Webviews

For the bulk of the Playwright testing within the react webviews, we test the functionality by comparing screenshots of the expected results to the current test state.

We can't use playwright's builtin locator functions, because VSCode webviews are sandboxed- due to cross-origin restrictions, their HTML content can't be accessed outside the webview context (which unfortunately is where the Playwright test suite is run).

However, we can still interact with the Webview content by using Playwright's keyboard/input functionality to tab to/type in content. It's slightly more tedious, but as of now the only option.

#### Limitations
For now, there's no way to access VSCode elements that run outside the playwright context; For example, things like the VSCode save dialog, or alert popups.

#### Starting tests
Focus on getting the screenshots of the expected state of the webview. This may require you experimenting with how to access different webview elements through keyboard functionality.

After writing all your tests, it’s important to rerun the test suite. This ensures that each test is correctly validating against the expected screenshots, rather than just generating new screenshots for your tests.