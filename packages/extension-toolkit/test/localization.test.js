/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const l10n = require("@vscode/l10n");
const { resolveLocalizationLanguage } = require("../dist/vscode/localization/language.js");
const { ProxyMessages } = require("../dist/vscode/localization/locConstants.js");

const l10nDirectory = path.resolve(__dirname, "..", "l10n");

describe("toolkit localization", () => {
    it("resolves supported VS Code languages and falls back to English", () => {
        assert.equal(resolveLocalizationLanguage("de"), "de");
        assert.equal(resolveLocalizationLanguage("fr-CA"), "fr");
        assert.equal(resolveLocalizationLanguage("pt"), "pt-br");
        assert.equal(resolveLocalizationLanguage("zh_Hant"), "zh-tw");
        assert.equal(resolveLocalizationLanguage("unsupported"), "en");
        assert.equal(resolveLocalizationLanguage(undefined), "en");
    });

    it("keeps every translated bundle aligned with the English source bundle", () => {
        const englishBundle = readBundle("bundle.l10n.json");
        const expectedKeys = Object.keys(englishBundle).sort();

        for (const fileName of fs.readdirSync(l10nDirectory)) {
            if (fileName === "bundle.l10n.json" || !fileName.endsWith(".json")) {
                continue;
            }

            assert.deepEqual(Object.keys(readBundle(fileName)).sort(), expectedKeys, fileName);
        }
    });

    it("loads translated messages and replaces parameters", () => {
        l10n.config({ contents: readBundle("bundle.l10n.de.json") });

        assert.equal(
            ProxyMessages.missingProtocolWarning("proxy.example"),
            "Proxyeinstellungen gefunden, jedoch ohne Protokoll (z. B. http://): „proxy.example“. Es können Verbindungsprobleme auftreten.",
        );
    });
});

function readBundle(fileName) {
    return JSON.parse(fs.readFileSync(path.join(l10nDirectory, fileName), "utf8"));
}
