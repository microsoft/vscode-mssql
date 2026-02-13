## Coverage Commands

### Prerequisites

- [Node.js](https://nodejs.org/en/) v18 or higher
- [yarn](https://yarnpkg.com/) v1.22.0 or higher, `npm install -g yarn`
- [nyc](https://www.npmjs.com/package/nyc) v17.1.0 or higher, `npm install -g nyc`

### ⚠️ Important

**Note:** You must fully **close out of all VSCode windows before running these tests.**
These tests launch a separate instance of VSCode in a clean environment using Electron.
If you have VSCode open, it can cause conflicts with the test-launched instance and lead to errors.

This happens because:

- An already running VSCode session can lock resources needed by the test instance.
- The test-launched VSCode process may fail to start properly when another session is open.
- It can cause instability, test failures, or crashes.

To avoid this, always ensure that **no VSCode windows are open** when running these tests.

### Instrumentation

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

After the code is instrumented, run the tests using

```shell
npx nyc --reporter=html --reporter=text-summary --include="src/reactviews/pages/**/*.tsx" npx playwright test
```

To pick up coverage data while testing, you have to run the instrumentation command every time you rebuild the project.

However, if you've only changed the tests, then you can run

```shell
yarn build; npx nyc --reporter=html --reporter=text-summary --include="src/reactviews/pages/**/*.tsx" npx playwright test
```

This will recompile your tests and run them for coverage.

#### Limitations

For now, there's no way to access VSCode elements that run outside the playwright context; For example, things like the VSCode save dialog, or alert popups.
