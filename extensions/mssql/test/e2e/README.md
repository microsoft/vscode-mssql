# MSSQL for VSCode Extension - E2E Tests

## Get started

### Limitations

If running extension tests from CLI, the VS Code version the tests run with cannot be running already. As a workaround, VS Code Insiders should be used for test development, so that tests may run in VS Code Stable.

For more information regarding this limitation, refer to [using insiders version for extension development.](https://code.visualstudio.com/api/working-with-extensions/testing-extension#using-insiders-version-for-extension-development)

### Prerequisites

- [Node.js](https://nodejs.org/en/) v18 or higher
- [yarn](https://yarnpkg.com/) v1.22.0 or higher, `npm install -g yarn`

---

### Setup

Tests are currently only setup to run locally.

1. Install root dependencies

From the root of the repo, install all of the build dependencies:

```shell
[sudo] yarn
```

2. Compile the extension and tests by running:

```shell
yarn build
```

or watch for changes in the tests by running:

```shell
yarn watch
```

### Running tests

To run tests, the following options can be used:

1. Using Playwright Test for VSCode:
   - Install the `Playwright Test for VSCode` extension in VS code.
   - [Run tests with a single click](https://github.com/microsoft/playwright-vscode/blob/main/README.md#run-tests-with-a-single-click)

   > Note: If you don't see any tests appearing in the **Test Explorer** view, like in the image, then you'll need to run them from the terminal first to get them to appear. Please refer to option 2.

![Playwright Test for VSCode Test Explorer](../../images/test-explorer-view.png).

2. Setup environment variables in the `test\e2e` folder
   - Create a `.env` file
   - Add the variables that you want based on the .env.example
   - Example:
     ```env
     VS_CODE_VERSION_NAME=stable
     SERVER_NAME=(localdb)\MSSqlLocalDb
     AUTHENTICATION_TYPE=Integrated
     PROFILE_NAME=test-server
     ```

3. To run tests from the command line execute the following command from the root:

   ```shell
   npx playwright test
   ```

The tests will automatically appear in the **Test Explorer** view after running them once, and green run icons will appear to the left of line numbers in the editor, like this:

![Run buttons to the left of line numbers in editor](../../images/editor-view-with-tests.png)
