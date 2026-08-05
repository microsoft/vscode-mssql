/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { describe, it } = require("node:test");
const l10n = require("@vscode/l10n");
const {
    resolveLocalizationLanguage,
    supportedLocalizationLanguages,
} = require("../dist/vscode/localization/language.js");
const {
    getProxyConfigurationIssueMessage,
    ProxyMessages,
} = require("../dist/vscode/localization/locConstants.js");

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

    it("ships a readable bundle for every supported language", () => {
        for (const language of supportedLocalizationLanguages) {
            const fileName =
                language === "en" ? "bundle.l10n.json" : `bundle.l10n.${language}.json`;
            assert.doesNotThrow(() => readBundle(fileName), fileName);
        }
    });

    it("falls back safely when new messages have not been translated yet", () => {
        l10n.config({ contents: readBundle("bundle.l10n.de.json") });

        assert.equal(
            ProxyMessages.missingProtocolWarning,
            "Proxy settings found, but without a protocol (e.g. http://). You may encounter connection issues.",
        );
        assert.equal(
            ProxyMessages.unsupportedProtocolWarning("socks5:"),
            "Proxy settings found, but the protocol 'socks5:' is not supported; only http and https proxies can be used. You may encounter connection issues.",
        );
    });

    it("does not include invalid proxy values in localized messages", () => {
        l10n.config({ contents: readBundle("bundle.l10n.json") });
        const secretProxy = "http://user:secret@proxy.example.com";

        const message = getProxyConfigurationIssueMessage({
            kind: "invalid-url",
            error: new Error(secretProxy),
        });

        assert.equal(
            message,
            "Proxy settings found, but the URL could not be parsed. You may encounter connection issues.",
        );
        assert.equal(message.includes(secretProxy), false);
    });
});

function readBundle(fileName) {
    return JSON.parse(fs.readFileSync(path.join(l10nDirectory, fileName), "utf8"));
}
