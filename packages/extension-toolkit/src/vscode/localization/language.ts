/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const DEFAULT_LANGUAGE: LocalizationLanguage = "en";

export const supportedLocalizationLanguages = [
    "de",
    "en",
    "es",
    "fr",
    "it",
    "ja",
    "ko",
    "pt-br",
    "ru",
    "zh-cn",
    "zh-tw",
] as const;

export type LocalizationLanguage = (typeof supportedLocalizationLanguages)[number];

const supportedLanguages = new Set<string>(supportedLocalizationLanguages);

const languageAliases: Record<string, LocalizationLanguage> = {
    pt: "pt-br",
    "zh-hans": "zh-cn",
    "zh-hant": "zh-tw",
};

/** Resolves a VS Code display language to a toolkit localization bundle. */
export function resolveLocalizationLanguage(language: string | undefined): LocalizationLanguage {
    const normalizedLanguage = language?.trim().toLowerCase().replaceAll("_", "-");
    if (!normalizedLanguage) {
        return DEFAULT_LANGUAGE;
    }

    const aliasedLanguage = languageAliases[normalizedLanguage] ?? normalizedLanguage;
    if (supportedLanguages.has(aliasedLanguage)) {
        return aliasedLanguage as LocalizationLanguage;
    }

    const baseLanguage = aliasedLanguage.split("-")[0];
    return supportedLanguages.has(baseLanguage)
        ? (baseLanguage as LocalizationLanguage)
        : DEFAULT_LANGUAGE;
}
