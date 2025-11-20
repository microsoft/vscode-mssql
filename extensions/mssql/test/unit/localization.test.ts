/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as l10n from "@vscode/l10n";
import * as path from "path";
import * as fs from "fs/promises";

suite("Localization Tests", () => {
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
            filePath = path.resolve(
                __dirname,
                "..",
                "..",
                "..",
                "l10n",
                "bundle.l10n.json",
            );
        }
        const fileContent = await fs.readFile(filePath, "utf8");
        await l10n.config({
            contents: JSON.parse(fileContent),
        });
    };

    test("Default Localization Test", async () => {
        const testLocalizationConstant = l10n.t("test");
        assert.equal(testLocalizationConstant, "test");
    });

    test("EN Localization Test", async () => {
        await setLocLang("en");
        const testLocalizationConstant = l10n.t("test");
        assert.equal(testLocalizationConstant, "test");
    });

    test("ES Localization Test", async () => {
        await setLocLang("es");
        const testLocalizationConstant = l10n.t("test");
        assert.equal(testLocalizationConstant, "prueba");
    });
});
