/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from "@vscode/l10n";
import { env } from "vscode";
import { LocalizationLanguage, resolveLocalizationLanguage } from "./language";

type LocalizationBundle = l10n.l10nJsonFormat;
type LocalizationBundleLoader = () => LocalizationBundle;

// Static require paths allow extension bundlers to include the JSON while regular npm consumers
// continue to load the files shipped in the toolkit package.
const localizationBundleLoaders: Record<LocalizationLanguage, LocalizationBundleLoader> = {
    de: () => require("../../../l10n/bundle.l10n.de.json") as LocalizationBundle,
    en: () => require("../../../l10n/bundle.l10n.json") as LocalizationBundle,
    es: () => require("../../../l10n/bundle.l10n.es.json") as LocalizationBundle,
    fr: () => require("../../../l10n/bundle.l10n.fr.json") as LocalizationBundle,
    it: () => require("../../../l10n/bundle.l10n.it.json") as LocalizationBundle,
    ja: () => require("../../../l10n/bundle.l10n.ja.json") as LocalizationBundle,
    ko: () => require("../../../l10n/bundle.l10n.ko.json") as LocalizationBundle,
    "pt-br": () => require("../../../l10n/bundle.l10n.pt-br.json") as LocalizationBundle,
    ru: () => require("../../../l10n/bundle.l10n.ru.json") as LocalizationBundle,
    "zh-cn": () => require("../../../l10n/bundle.l10n.zh-cn.json") as LocalizationBundle,
    "zh-tw": () => require("../../../l10n/bundle.l10n.zh-tw.json") as LocalizationBundle,
};

/**
 * Initializes the toolkit localization bundle for the current VS Code display language.
 * Unsupported languages fall back to English.
 *
 * This must be called during extension activation before using localized toolkit APIs.
 */
export function initializeExtensionToolkit(): void {
    const language = resolveLocalizationLanguage(env.language);
    l10n.config({ contents: localizationBundleLoaders[language]() });
}
