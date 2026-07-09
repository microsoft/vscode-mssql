/// <reference path="globals/istanbul/index.d.ts" />
/// <reference path="third-party-webview-modules.d.ts" />

declare module "*.css";
declare module "*.svg" {
    const url: string;
    export default url;
}

declare module "monaco-editor/esm/vs/basic-languages/sql/sql.js" {
    import type { languages } from "monaco-editor";

    export const conf: languages.LanguageConfiguration;
    export const language: languages.IMonarchLanguage & {
        readonly operators?: readonly string[];
    };
}
