/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as l10n from "@vscode/l10n";
import * as path from "path";
import * as fs from "fs/promises";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { resetLoggerDefaultChannelForTest } from "../../src/models/logger";

suite("Localization Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
        resetLoggerDefaultChannelForTest();

        const disposable = { dispose: sandbox.stub() } as vscode.Disposable;
        const outputChannel = {
            name: "MSSQL",
            logLevel: vscode.LogLevel.Info,
            onDidChangeLogLevel: sandbox.stub().returns(disposable),
            append: sandbox.stub(),
            appendLine: sandbox.stub(),
            clear: sandbox.stub(),
            show: sandbox.stub(),
            replace: sandbox.stub(),
            hide: sandbox.stub(),
            trace: sandbox.stub(),
            debug: sandbox.stub(),
            info: sandbox.stub(),
            warn: sandbox.stub(),
            error: sandbox.stub(),
            dispose: sandbox.stub(),
        } as unknown as vscode.LogOutputChannel;

        sandbox.stub(vscode.window, "createOutputChannel").returns(outputChannel);
    });

    teardown(() => {
        sandbox.restore();
        resetLoggerDefaultChannelForTest();
    });

    let setLocLang = async (lang: string) => {
        let filePath = path.resolve(
            __dirname,
            "..",
            "..",
            "..",
            "l10n",
            `bundle.l10n.${lang}.json`,
        );
        if (lang === "en") {
            filePath = path.resolve(__dirname, "..", "..", "..", "l10n", "bundle.l10n.json");
        }
        const fileContent = await fs.readFile(filePath, "utf8");
        await l10n.config({
            contents: JSON.parse(fileContent),
        });
    };

    test("Default Localization Test", async () => {
        const testLocalizationConstant = l10n.t("test");
        expect(testLocalizationConstant).to.equal("test");
    });

    test("EN Localization Test", async () => {
        await setLocLang("en");
        const testLocalizationConstant = l10n.t("test");
        expect(testLocalizationConstant).to.equal("test");
    });

    test("ES Localization Test", async () => {
        await setLocLang("es");
        const testLocalizationConstant = l10n.t("test");
        expect(testLocalizationConstant).to.equal("prueba");
    });

    suiteTeardown(async () => {
        await setLocLang("en");
    });
});
