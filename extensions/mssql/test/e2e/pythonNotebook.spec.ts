/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as cp from "child_process";
import { randomUUID } from "crypto";
import { test, expect } from "./baseFixtures";
import { QuickInput } from "./pageObjects";
import { usePerTestVsCodeLifecycle } from "./utils/testLifecycle";

test.describe("Python Notebook Preview", () => {
    test.skip(
        process.env["MSSQL_PYTHON_NOTEBOOK_SMOKE"] !== "1",
        "Enable MSSQL_PYTHON_NOTEBOOK_SMOKE and prepare Python/Jupyter extensions first.",
    );
    const profileId = "f1375aa5-932e-4a94-afc8-8fe53dca4862";
    const server = process.env["MSSQL_NOTEBOOK_TEST_SERVER"];
    const authentication = process.env["MSSQL_NOTEBOOK_TEST_AUTHENTICATION"] ?? "sql";
    const integrated = authentication === "integrated";
    const database = process.env["MSSQL_NOTEBOOK_TEST_DATABASE"] ?? "selected_notebook_database";
    const interpreter = process.env["MSSQL_NOTEBOOK_PYTHON"];
    const isolationServer = process.env["MSSQL_NOTEBOOK_ISOLATION_SERVER"];
    const isolationDatabase = process.env["MSSQL_NOTEBOOK_ISOLATION_DATABASE"];
    const isolationIntegrated =
        process.env["MSSQL_NOTEBOOK_ISOLATION_AUTHENTICATION"] === "integrated";
    const catalogTable = `notebook_intellisense_${randomUUID().replace(/-/g, "")}`;
    const catalogColumn = "notebook_catalog_value";
    const isolationCatalogColumn = "other_notebook_catalog_value";
    let catalogFixtureRequested = false;
    let isolationFixtureRequested = false;

    function catalogFixture(action: "create" | "drop", isolation = false): void {
        const result = cp.spawnSync(
            interpreter!,
            [
                "-c",
                [
                    "import os, sys, mssql_python",
                    "integrated = os.environ.get('MSSQL_NOTEBOOK_TEST_AUTHENTICATION') == 'integrated'",
                    "auth = {'trusted_connection': 'yes'} if integrated else {'uid': os.environ['MSSQL_NOTEBOOK_TEST_USER'], 'pwd': os.environ['MSSQL_NOTEBOOK_TEST_PASSWORD']}",
                    "connection = mssql_python.connect(server=os.environ['MSSQL_NOTEBOOK_TEST_SERVER'], database=os.environ['MSSQL_NOTEBOOK_TEST_DATABASE'], encrypt='yes', trustservercertificate='yes' if os.environ.get('MSSQL_NOTEBOOK_TEST_TRUST_CERTIFICATE') == '1' else 'no', autocommit=True, timeout=15, **auth)",
                    "try:",
                    "    cursor = connection.cursor()",
                    "    table, column, action = sys.argv[1:]",
                    "    assert table.startswith('notebook_intellisense_') and table.replace('_', '').isalnum()",
                    "    assert column in ('notebook_catalog_value', 'other_notebook_catalog_value')",
                    "    cursor.execute(f'CREATE TABLE dbo.[{table}] ([{column}] int NOT NULL)' if action == 'create' else f'DROP TABLE IF EXISTS dbo.[{table}]')",
                    "    exists = cursor.execute('SELECT COUNT(*) FROM sys.tables WHERE name = ?', (table,)).fetchone()[0]",
                    "    assert exists == (1 if action == 'create' else 0)",
                    "    cursor.close()",
                    "finally:",
                    "    connection.close()",
                ].join("\n"),
                catalogTable,
                isolation ? isolationCatalogColumn : catalogColumn,
                action,
            ],
            {
                encoding: "utf8",
                timeout: 30_000,
                env: isolation
                    ? {
                          ...process.env,
                          MSSQL_NOTEBOOK_TEST_SERVER: isolationServer,
                          MSSQL_NOTEBOOK_TEST_DATABASE: isolationDatabase,
                          MSSQL_NOTEBOOK_TEST_AUTHENTICATION: isolationIntegrated
                              ? "integrated"
                              : "sql",
                          MSSQL_NOTEBOOK_TEST_USER: process.env["MSSQL_NOTEBOOK_ISOLATION_USER"],
                          MSSQL_NOTEBOOK_TEST_PASSWORD:
                              process.env["MSSQL_NOTEBOOK_ISOLATION_PASSWORD"],
                          MSSQL_NOTEBOOK_TEST_TRUST_CERTIFICATE:
                              process.env["MSSQL_NOTEBOOK_ISOLATION_TRUST_CERTIFICATE"],
                      }
                    : process.env,
            },
        );
        expect(result.error, `Catalog fixture ${action} process`).toBeUndefined();
        expect(result.status, `Catalog fixture ${action} exit code`).toBe(0);
    }

    const getContext = usePerTestVsCodeLifecycle({
        launchOptions: {
            useVsix: !!process.env["BUILT_VSIX_PATH"],
            extraLaunchArgs: ["--log", "trace"],
            initialConfig: {
                "mssql.showChangelogOnUpdate": false,
                "mssql.enableExperimentalFeatures": false,
                "mssql.preview.pythonNotebooks": true,
                "files.simpleDialog.enable": true,
                "window.dialogStyle": "custom",
                "python.defaultInterpreterPath": interpreter,
                "editor.quickSuggestions": false,
                "editor.suggestOnTriggerCharacters": false,
                "[python]": { "editor.suggestOnTriggerCharacters": true },
                "editor.autoClosingBrackets": "never",
                "editor.autoClosingQuotes": "never",
                "mssql.connections": [
                    {
                        id: profileId,
                        profileName: "Python Notebook Smoke",
                        server: server ?? "localhost",
                        database,
                        authenticationType: integrated ? "Integrated" : "SqlLogin",
                        user: integrated
                            ? undefined
                            : (process.env["MSSQL_NOTEBOOK_TEST_USER"] ?? "notebook_test"),
                        savePassword: false,
                        trustServerCertificate:
                            process.env["MSSQL_NOTEBOOK_TEST_TRUST_CERTIFICATE"] === "1",
                    },
                    ...(isolationServer
                        ? [
                              {
                                  id: "49670066-2bee-4dfe-a687-dd13df613209",
                                  profileName: "Python Notebook Isolation",
                                  server: isolationServer,
                                  database: isolationDatabase,
                                  authenticationType: isolationIntegrated
                                      ? "Integrated"
                                      : "SqlLogin",
                                  user: isolationIntegrated
                                      ? undefined
                                      : process.env["MSSQL_NOTEBOOK_ISOLATION_USER"],
                                  savePassword: false,
                                  trustServerCertificate:
                                      process.env["MSSQL_NOTEBOOK_ISOLATION_TRUST_CERTIFICATE"] ===
                                      "1",
                              },
                          ]
                        : []),
                ],
            },
        },
        beforeClose: async ({ userDataDir }, testInfo) => {
            try {
                if (testInfo.status !== testInfo.expectedStatus) {
                    const logs = path.join(userDataDir, "logs");
                    const entries = await fs.promises.readdir(logs, { recursive: true });
                    const diagnostics: string[] = [];
                    for (const entry of entries.filter((entry) => entry.endsWith(".log"))) {
                        const contents = await fs.promises.readFile(path.join(logs, entry), "utf8");
                        diagnostics.push(
                            ...contents
                                .split(/\r?\n/)
                                .filter((line) => line.includes("Python notebook IntelliSense ")),
                        );
                    }
                    console.log(diagnostics.join("\n"));
                }
            } finally {
                try {
                    if (isolationFixtureRequested) catalogFixture("drop", true);
                } finally {
                    if (catalogFixtureRequested) catalogFixture("drop");
                }
            }
        },
    });

    test("creates from Object Explorer and persists a secret-free Python connection reference", async () => {
        const { page, userDataDir } = getContext();
        const notebook = page.locator(".notebookOverlay.notebook-editor:not([inert]):visible");
        const connection = page.getByRole("treeitem", { name: /Python Notebook Smoke/ }).first();
        await expect(connection).toBeVisible({ timeout: 60_000 });
        await connection.click({ button: "right" });
        await page
            .getByRole("menuitem", { name: "New Python Notebook (Preview)", exact: true })
            .click();
        await expect(notebook).toBeVisible({ timeout: 30_000 });

        const quick = new QuickInput(page);
        if (server) {
            expect(["sql", "integrated"]).toContain(authentication);
            expect(interpreter, "Specify the isolated Python notebook interpreter").toBeTruthy();
            if (!integrated) {
                expect(
                    process.env["MSSQL_NOTEBOOK_TEST_PASSWORD"],
                    "Specify the test SQL password",
                ).toBeTruthy();
            }
            catalogFixtureRequested = true;
            catalogFixture("create");
            const authorizeNotebook = async (
                isIntegrated: boolean,
                secret?: string,
                chooseConnection = false,
            ) => {
                const environmentName = path.basename(path.dirname(path.dirname(interpreter!)));
                await page.getByRole("button", { name: "Connect", exact: true }).click();
                if (chooseConnection) {
                    await quick.rows.filter({ hasText: "Python Notebook Smoke" }).click();
                }
                const selectedKernel = notebook.getByRole("button", {
                    name: new RegExp(environmentName),
                });
                const environment = quick.rows.filter({ hasText: environmentName });
                const environments = quick.rows.filter({ hasText: "Python Environments..." });
                const anotherKernel = quick.rows.filter({ hasText: "Select Another Kernel..." });
                await expect(environment.or(environments).or(anotherKernel).first()).toBeVisible({
                    timeout: 60_000,
                });
                if (!(await environment.isVisible()) && (await anotherKernel.isVisible())) {
                    await anotherKernel.click();
                }
                await expect(environment.or(environments).first()).toBeVisible({ timeout: 60_000 });
                if (await environments.isVisible()) await environments.click();
                await expect(environment).toHaveCount(1, { timeout: 60_000 });
                await environment.click();
                await expect(selectedKernel).toBeVisible({ timeout: 60_000 });
                await expect(page.locator(".quick-input-widget:visible")).toHaveCount(0);
                const initialization = notebook
                    .getByRole("listitem", { name: "code cell", exact: true })
                    .first();
                await expect(initialization.getByText("[1]", { exact: true })).toBeVisible({
                    timeout: 120_000,
                });
                await page
                    .getByRole("button", { name: "Allow Kernel Access", exact: true })
                    .click();
                const password = page.locator('.quick-input-widget input[type="password"]');
                const jupyterConsent = page
                    .getByRole("dialog", { name: /Do you want to grant Kernel access/ })
                    .getByRole("button", { name: "Allow", exact: true });
                const connected = page.getByText(
                    "Python notebook connected. Use %%tsql or mssql.query() to query the selected database.",
                    { exact: true },
                );
                await expect(
                    (isIntegrated ? connected : password).or(jupyterConsent).first(),
                ).toBeVisible({ timeout: 30_000 });
                if (await jupyterConsent.isVisible()) {
                    await jupyterConsent.click();
                }
                if (!isIntegrated) {
                    await expect(password).toBeVisible({ timeout: 30_000 });
                    expect(secret, "Specify the test SQL password").toBeTruthy();
                    await password.fill(secret!);
                    await password.press("Enter");
                }
                await expect(connected).toBeVisible({ timeout: 60_000 });
                await expect(
                    notebook.getByRole("button", { name: /Disconnect (SQL|Python Notebook)/ }),
                ).toBeVisible({ timeout: 30_000 });
            };
            await test.step("starts Python and explicitly authorizes the selected SQL connection", () =>
                authorizeNotebook(integrated, process.env["MSSQL_NOTEBOOK_TEST_PASSWORD"]));
            await test.step("binds T-SQL results and passes Python values back as parameters", async () => {
                const cells = notebook.getByRole("listitem", { name: "code cell", exact: true });
                const sql = cells.filter({ hasText: "%%tsql --bind df" });
                await sql.locator(".view-lines").click();
                await page.keyboard.press("Shift+Enter");
                await expect(sql.getByText("[2]", { exact: true })).toBeVisible({
                    timeout: 30_000,
                });
                await cells.last().locator(".view-lines").click();
                const modifier = process.platform === "darwin" ? "Meta" : "Control";
                await page.keyboard.press(`${modifier}+a`);
                await page.keyboard.insertText(
                    'assert int(df["value"].sum()) == 1\n' +
                        'query_values = [int(df["value"].sum()) + 41]\n' +
                        'mssql.query("CREATE TABLE #notebook_smoke (value int)")\n' +
                        'assert mssql.query("SELECT DB_NAME() AS db").iloc[0, 0] == ' +
                        JSON.stringify(database),
                );
                await page.keyboard.press("Shift+Enter");
                await expect(
                    cells
                        .filter({ hasText: "CREATE TABLE #notebook_smoke" })
                        .getByText("[3]", { exact: true }),
                ).toBeVisible({
                    timeout: 30_000,
                });
                await cells.last().locator(".view-lines").click();
                await page.keyboard.insertText(
                    "%%tsql --bind answer --params query_values\n" +
                        "INSERT INTO #notebook_smoke VALUES (?);\n" +
                        "SELECT value FROM #notebook_smoke;",
                );
                await page.keyboard.press("Shift+Enter");
                await expect(
                    cells
                        .filter({ hasText: "%%tsql --bind answer" })
                        .getByText("[4]", { exact: true }),
                ).toBeVisible({
                    timeout: 30_000,
                });
                const verification = cells.last();
                await verification.locator(".view-lines").click();
                await page.keyboard.insertText(
                    "assert answer.iloc[0, 0] == 42\n" +
                        'assert mssql.query("SELECT value FROM #notebook_smoke").iloc[0, 0] == 42\n' +
                        'print("MSSQL_NOTEBOOK_SMOKE_OK")',
                );
                await page.keyboard.press("Shift+Enter");
                await expect(
                    notebook
                        .frameLocator("iframe")
                        .frameLocator("#active-frame")
                        .getByText("MSSQL_NOTEBOOK_SMOKE_OK", { exact: true }),
                ).toBeVisible({ timeout: 30_000 });
            });
            await test.step("preserves Python completion and offers SQL catalog completion, hover and active parameters without executing the cell", async () => {
                const modifier = process.platform === "darwin" ? "Meta" : "Control";
                const authoring = notebook
                    .getByRole("listitem", { name: "code cell", exact: true })
                    .last();
                await authoring.locator(".view-lines").click();
                await page.keyboard.insertText("query_val");
                await quick.runCommand("Trigger Suggest", "Trigger Suggest");
                const pythonSuggestion = page
                    .locator(".suggest-widget.visible .monaco-list-row")
                    .filter({ hasText: "query_values" });
                await expect(pythonSuggestion.first()).toBeVisible({ timeout: 30_000 });
                await pythonSuggestion.first().click();
                await page.keyboard.press(`${modifier}+a`);
                await page.keyboard.insertText(
                    `%%tsql --bind catalog_result\nSELECT t.\nFROM dbo.${catalogTable} AS t;`,
                );
                await page.keyboard.press(`${modifier}+Home`);
                await page.keyboard.press("ArrowDown");
                await page.keyboard.press("End");
                const suggestion = page
                    .locator(".suggest-widget.visible .monaco-list-row")
                    .filter({ hasText: catalogColumn });
                await quick.runCommand("Trigger Suggest", "Trigger Suggest");
                await expect(suggestion.first()).toBeVisible({ timeout: 30_000 });
                await suggestion.first().click();
                await expect(authoring.locator(".view-lines")).toContainText(`t.${catalogColumn}`);
                await expect(authoring.locator(".view-lines")).toContainText(
                    "%%tsql --bind catalog_result",
                );
                await expect(authoring.locator(".execution-count-label")).not.toContainText(
                    /\[\d+\]/,
                );
                await authoring.locator(".view-lines").click();
                await page.keyboard.press(`${modifier}+a`);
                await page.keyboard.insertText("%%tsql --bind catalog_result\nSELECT * FROM dbo");
                await page.keyboard.type(".");
                await expect(
                    page.locator(".suggest-widget.visible .monaco-list-row").first(),
                ).toBeVisible({ timeout: 30_000 });
                await page.keyboard.type("notebook_");
                const tableSuggestion = page
                    .locator(".suggest-widget.visible .monaco-list-row")
                    .filter({ hasText: catalogTable });
                await expect(tableSuggestion.first()).toBeVisible({ timeout: 30_000 });
                await tableSuggestion.first().click();
                await expect(authoring.locator(".view-lines")).toContainText(catalogTable);
                await authoring.locator(".view-lines").click();
                await page.keyboard.press(`${modifier}+Home`);
                await page.keyboard.press("ArrowDown");
                await page.keyboard.press("Home");
                await page.keyboard.press(`${modifier}+Shift+End`);
                const databaseIdentifier = `[${database.replaceAll("]", "]]")}]`;
                await page.keyboard.insertText(`SELECT * FROM ${databaseIdentifier}`);
                await page.keyboard.type(".");
                await expect(
                    page
                        .locator(".suggest-widget.visible .monaco-list-row")
                        .filter({ hasText: "dbo" })
                        .first(),
                ).toBeVisible({ timeout: 30_000 });
                await page.keyboard.press("Escape");
                await authoring.locator(".view-lines").click();
                await page.keyboard.press(`${modifier}+a`);
                await page.keyboard.insertText("%%tsql --bind catalog_result\nUSE ");
                await quick.runCommand("Trigger Suggest", "Trigger Suggest");
                await expect(
                    page
                        .locator(".suggest-widget.visible .monaco-list-row")
                        .filter({ hasText: database })
                        .first(),
                ).toBeVisible({ timeout: 30_000 });
                await page.keyboard.press("Escape");
                await authoring.locator(".view-lines").click();
                await page.keyboard.press(`${modifier}+a`);
                await page.keyboard.insertText(
                    `%%tsql --bind catalog_result\nSELECT t.${catalogColumn}\nFROM dbo.${catalogTable} AS t;`,
                );
                await page.keyboard.press(`${modifier}+Home`);
                await page.keyboard.press("ArrowDown");
                await page.keyboard.press("End");
                await page.keyboard.press("ArrowLeft");
                await page.keyboard.press(`${modifier}+k`);
                await page.keyboard.press(`${modifier}+i`);
                const hover = page.locator(".monaco-hover:visible");
                await expect(hover).toContainText(catalogColumn, { timeout: 30_000 });
                await expect(hover).toContainText(/int/i);
                await page.keyboard.press("Escape");
                await authoring.locator(".view-lines").click();
                await page.keyboard.press(`${modifier}+a`);
                await page.keyboard.insertText(
                    "%%tsql --bind catalog_result\nSELECT SUBSTRING('abc', ",
                );
                await page.keyboard.press(`${modifier}+Shift+Space`);
                const signature = page.locator(".parameter-hints-widget.visible");
                await expect(signature).toContainText(/SUBSTRING/i, { timeout: 30_000 });
                await expect(signature.locator(".parameter.active")).toContainText(/start/i);
                await page.keyboard.press("Escape");
            });
            if (isolationServer) {
                await test.step("isolates identical SQL cell text between two live notebook databases", async () => {
                    expect(isolationDatabase, "Specify the second user database").toBeTruthy();
                    isolationFixtureRequested = true;
                    catalogFixture("create", true);
                    const primaryNotebookId = await notebook.getAttribute("id");
                    expect(primaryNotebookId).toBeTruthy();
                    const otherConnection = page.getByRole("treeitem", {
                        name: /Python Notebook Isolation/,
                    });
                    await otherConnection.click({ button: "right" });
                    await page
                        .getByRole("menuitem", {
                            name: "New Python Notebook (Preview)",
                            exact: true,
                        })
                        .click();
                    await expect(notebook).toHaveCount(1);
                    await expect(notebook).not.toHaveAttribute("id", primaryNotebookId!);
                    await authorizeNotebook(
                        isolationIntegrated,
                        process.env["MSSQL_NOTEBOOK_ISOLATION_PASSWORD"],
                    );
                    const modifier = process.platform === "darwin" ? "Meta" : "Control";
                    const sql = `%%tsql --bind catalog_result\nSELECT t.\nFROM dbo.${catalogTable} AS t;`;
                    const rows = page.locator(".suggest-widget.visible .monaco-list-row");
                    const requestCompletion = async () => {
                        await notebook
                            .getByRole("listitem", { name: "code cell", exact: true })
                            .last()
                            .locator(".view-lines")
                            .click();
                        await page.keyboard.press(`${modifier}+a`);
                        await page.keyboard.insertText(sql);
                        await page.keyboard.press(`${modifier}+Home`);
                        await page.keyboard.press("ArrowDown");
                        await page.keyboard.press("End");
                        await quick.runCommand("Trigger Suggest", "Trigger Suggest");
                    };
                    await requestCompletion();
                    await expect(rows.filter({ hasText: isolationCatalogColumn })).toBeVisible({
                        timeout: 30_000,
                    });
                    await expect(
                        rows.filter({ hasText: new RegExp(`^${catalogColumn}\\b`) }),
                    ).toHaveCount(0);
                    await page.keyboard.press("Escape");
                    await page.keyboard.press(`${modifier}+w`);
                    await page.getByRole("button", { name: "Don't Save", exact: true }).click();
                    await expect(notebook).toHaveAttribute("id", primaryNotebookId!);
                    await requestCompletion();
                    await expect(
                        rows.filter({ hasText: new RegExp(`^${catalogColumn}\\b`) }),
                    ).toBeVisible({ timeout: 30_000 });
                    await expect(rows.filter({ hasText: isolationCatalogColumn })).toHaveCount(0);
                    await page.keyboard.press("Escape");
                });
            }
            await test.step("connects a regular notebook through its toast without executing SQL for setup", async () => {
                // Kernel working directories stay locked on Windows until lifecycle shutdown.
                const directory = await fs.promises.mkdtemp(
                    path.join(userDataDir, "mssql-generic-python-"),
                );
                const filename = path.join(directory, "generic.ipynb");
                try {
                    await fs.promises.writeFile(
                        filename,
                        JSON.stringify({
                            cells: [
                                {
                                    cell_type: "code",
                                    metadata: {},
                                    execution_count: null,
                                    outputs: [],
                                    source: [
                                        "%%tsql --bind generic_result\n",
                                        "SELECT DB_NAME() AS [database];",
                                    ],
                                },
                                {
                                    cell_type: "code",
                                    metadata: {},
                                    execution_count: null,
                                    outputs: [],
                                    source: [
                                        `assert generic_result.iloc[0, 0] == ${JSON.stringify(database)}\n`,
                                        "print('MSSQL_GENERIC_NOTEBOOK_SMOKE_OK')",
                                    ],
                                },
                            ],
                            metadata: { language_info: { name: "python" } },
                            nbformat: 4,
                            nbformat_minor: 4,
                        }),
                    );
                    const primaryNotebookId = await notebook.getAttribute("id");
                    await quick.open();
                    await quick.input.fill(filename);
                    await quick.pick("generic.ipynb");
                    await expect(notebook).not.toHaveAttribute("id", primaryNotebookId!);
                    await authorizeNotebook(
                        integrated,
                        process.env["MSSQL_NOTEBOOK_TEST_PASSWORD"],
                        true,
                    );
                    const sql = notebook
                        .getByRole("listitem", { name: "code cell", exact: true })
                        .filter({ hasText: "%%tsql --bind generic_result" });
                    await expect(sql.getByText(/^\[\d+\]$/)).toHaveCount(0);
                    await sql.locator(".view-lines").click();
                    await page.keyboard.press("Shift+Enter");
                    await expect(sql.getByText("[2]", { exact: true })).toBeVisible({
                        timeout: 30_000,
                    });
                    const python = notebook
                        .getByRole("listitem", { name: "code cell", exact: true })
                        .filter({ hasText: "assert generic_result" });
                    await python.locator(".view-lines").click();
                    await page.keyboard.press("Shift+Enter");
                    const modifier = process.platform === "darwin" ? "Meta" : "Control";
                    await expect
                        .poll(
                            async () => {
                                await page.keyboard.press(`${modifier}+s`);
                                const saved = JSON.parse(
                                    await fs.promises.readFile(filename, "utf8"),
                                );
                                return saved.cells.some(
                                    (cell: {
                                        outputs: { output_type: string; text?: string[] }[];
                                    }) =>
                                        cell.outputs.some(
                                            (output) =>
                                                output.output_type === "stream" &&
                                                output.text
                                                    ?.join("")
                                                    .includes("MSSQL_GENERIC_NOTEBOOK_SMOKE_OK"),
                                        ),
                                );
                            },
                            { timeout: 30_000 },
                        )
                        .toBe(true);
                    const saved = JSON.parse(await fs.promises.readFile(filename, "utf8"));
                    expect(saved.metadata.mssqlPythonNotebook).toEqual({
                        version: 1,
                        connectionId: profileId,
                        database,
                    });
                    expect(JSON.stringify(saved)).not.toMatch(
                        /password|accessToken|brokerUrl|capability/,
                    );
                    await page.keyboard.press(`${modifier}+w`);
                    const save = page
                        .getByRole("dialog", {
                            name: /Do you want to save the changes you made to generic\.ipynb/,
                        })
                        .getByRole("button", { name: "Save", exact: true });
                    const primary = notebook.and(page.locator(`[id="${primaryNotebookId}"]`));
                    await expect(primary.or(save).first()).toBeVisible({ timeout: 15_000 });
                    if (await save.isVisible()) await save.click();
                    await expect(notebook).toHaveAttribute("id", primaryNotebookId!);
                } finally {
                    await fs.promises.rm(filename, { force: true });
                }
            });
        }
        const directory = await fs.promises.mkdtemp(
            path.join(userDataDir, "mssql-python-notebook-"),
        );
        const filename = path.join(directory, "connected.ipynb");
        try {
            await quick.runCommand("File: Save As", "File: Save As...");
            await expect(quick.widget.locator(".quick-input-title")).toHaveText("Save As");
            await quick.input.fill(filename);
            await expect(quick.widget.getByRole("progressbar")).toBeHidden({ timeout: 30_000 });
            await quick.widget.getByRole("button", { name: "OK", exact: true }).click();
            let contents = "";
            await expect
                .poll(
                    async () => {
                        contents = fs.existsSync(filename)
                            ? await fs.promises.readFile(filename, "utf8")
                            : "";
                        try {
                            JSON.parse(contents);
                            return true;
                        } catch (error) {
                            if (error instanceof SyntaxError) return false;
                            throw error;
                        }
                    },
                    { timeout: 15_000 },
                )
                .toBe(true);
            const saved = JSON.parse(contents);
            expect(saved.metadata.kernelspec.language).toBe("python");
            expect(saved.metadata.mssqlPythonNotebook).toEqual({
                version: 1,
                connectionId: profileId,
                database,
            });
            expect(
                saved.cells
                    .filter((cell: { cell_type: string }) => cell.cell_type === "code")
                    .some((cell: { source: string[] }) =>
                        cell.source.join("").includes("%%tsql --bind df"),
                    ),
            ).toBe(true);
            expect(JSON.stringify(saved)).not.toMatch(/password|accessToken|brokerUrl|capability/);
            if (server) {
                if (!integrated) {
                    expect(JSON.stringify(saved)).not.toContain(
                        process.env["MSSQL_NOTEBOOK_TEST_PASSWORD"]!,
                    );
                }
                expect(JSON.stringify(saved)).toContain("MSSQL_NOTEBOOK_SMOKE_OK");
                expect(
                    saved.cells
                        .filter((cell: { cell_type: string }) => cell.cell_type === "code")
                        .flatMap((cell: { outputs: { output_type: string }[] }) => cell.outputs)
                        .filter(
                            (output: { output_type: string }) => output.output_type === "error",
                        ),
                ).toEqual([]);
            }

            const modifier = process.platform === "darwin" ? "Meta" : "Control";
            await page.keyboard.press(`${modifier}+w`);
            await expect(notebook).toBeHidden();
            await page.keyboard.press(`${modifier}+p`);
            await quick.input.fill(filename);
            await quick.pick(path.basename(filename));
            await expect(notebook).toBeVisible({ timeout: 30_000 });
            await expect(
                page.getByRole("button", { name: "Allow Kernel Access", exact: true }),
            ).toHaveCount(0);
        } finally {
            await fs.promises.rm(filename, { force: true });
        }
    });
});
