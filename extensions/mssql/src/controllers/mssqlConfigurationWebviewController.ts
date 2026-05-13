/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { getErrorMessage } from "../utils/utils";
import { KeybindingsService } from "../keybindings/keybindingsService";
import {
    getQuickQueryCommandId,
    MssqlSettingDefinition,
    MssqlSettingInputType,
    MssqlConfigurationReducers,
    MssqlConfigurationWebviewState,
    normalizeQuickQueries,
    quickQueryCount,
} from "../sharedInterfaces/mssqlConfiguration";
import { WebviewPanelController } from "./webviewPanelController";
import VscodeWrapper from "./vscodeWrapper";

export class MssqlConfigurationWebviewController extends WebviewPanelController<
    MssqlConfigurationWebviewState,
    MssqlConfigurationReducers,
    void
> {
    private readonly keybindingsService: KeybindingsService;

    constructor(
        context: vscode.ExtensionContext,
        vscodeWrapper: VscodeWrapper,
        focusedQuickQuerySlot?: number,
    ) {
        super(
            context,
            vscodeWrapper,
            "mssqlConfiguration",
            "MssqlConfiguration",
            {
                quickQueries: normalizeQuickQueries(undefined),
                quickQueryKeybindings: {},
                webviewShortcuts: {},
                mssqlSettings: {},
                mssqlSettingDefinitions: [],
                focusedQuickQuerySlot,
            },
            {
                title: "MSSQL Configuration",
                viewColumn: vscode.ViewColumn.One,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "settingsGear_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "settingsGear_light.svg",
                    ),
                },
            },
        );

        this.keybindingsService = new KeybindingsService(context);
        this.registerRpcHandlers();
        this.registerDisposable(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration("mssql")) {
                    void this.refreshState();
                }
            }),
        );
        void this.refreshState(undefined, undefined, focusedQuickQuerySlot);
    }

    private registerRpcHandlers(): void {
        this.registerReducer("closeDialog", async (state) => {
            this.panel.dispose();
            return state;
        });

        this.registerReducer("reloadConfiguration", async () => {
            return await this.getConfigurationState("Configuration reloaded.");
        });

        this.registerReducer("saveConfiguration", async (state, payload) => {
            this.state = { ...state, isSaving: true, message: undefined, errorMessage: undefined };
            const quickQueries = normalizeQuickQueries(payload.quickQueries);
            const webviewShortcuts = payload.webviewShortcuts ?? {};
            const mssqlSettings = payload.mssqlSettings ?? {};

            try {
                await this.updateMssqlSettings(mssqlSettings);
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configQuickQueries,
                        quickQueries,
                        vscode.ConfigurationTarget.Global,
                    );
                await vscode.workspace
                    .getConfiguration()
                    .update(
                        Constants.configShortcuts,
                        webviewShortcuts,
                        vscode.ConfigurationTarget.Global,
                    );

                try {
                    await this.keybindingsService.updateCommandKeybindings(
                        this.getQuickQueryCommandIds().map((command) => ({
                            command,
                            key: payload.quickQueryKeybindings?.[command] ?? "",
                        })),
                    );
                } catch (error) {
                    await this.keybindingsService.openKeybindingsFile();
                    throw new Error(
                        `${getErrorMessage(error)} The keybindings file has been opened for manual editing.`,
                    );
                }

                return await this.getConfigurationState("Configuration saved.");
            } catch (error) {
                return {
                    ...state,
                    quickQueries,
                    webviewShortcuts,
                    quickQueryKeybindings: payload.quickQueryKeybindings ?? {},
                    mssqlSettings,
                    isSaving: false,
                    message: undefined,
                    errorMessage: getErrorMessage(error),
                };
            }
        });
    }

    private async refreshState(
        message?: string,
        errorMessage?: string,
        focusedQuickQuerySlot?: number,
    ): Promise<void> {
        this.state = await this.getConfigurationState(message, errorMessage, focusedQuickQuerySlot);
    }

    public focusQuickQuerySlot(focusedQuickQuerySlot?: number): void {
        this.state = { ...this.state, focusedQuickQuerySlot };
    }

    private async getConfigurationState(
        message?: string,
        errorMessage?: string,
        focusedQuickQuerySlot?: number,
    ): Promise<MssqlConfigurationWebviewState> {
        let keybindings: Record<string, string> = {};
        let stateErrorMessage = errorMessage;

        try {
            keybindings = await this.keybindingsService.getCommandKeybindings(
                this.getQuickQueryCommandIds(),
            );
        } catch (error) {
            stateErrorMessage = getErrorMessage(error);
        }

        return {
            quickQueries: normalizeQuickQueries(
                vscode.workspace.getConfiguration().get(Constants.configQuickQueries),
            ),
            quickQueryKeybindings: keybindings,
            webviewShortcuts:
                vscode.workspace
                    .getConfiguration()
                    .get<Record<string, string>>(Constants.configShortcuts) ?? {},
            mssqlSettings: this.getMssqlSettings(),
            mssqlSettingDefinitions: this.getMssqlSettingDefinitions(),
            focusedQuickQuerySlot,
            message,
            errorMessage: stateErrorMessage,
            isSaving: false,
        };
    }

    private getQuickQueryCommandIds(): string[] {
        return Array.from({ length: quickQueryCount }, (_unused, index) =>
            getQuickQueryCommandId(index + 1),
        );
    }

    private getMssqlConfigurationProperties(): Record<string, any> {
        return (
            vscode.extensions.getExtension(Constants.extensionId)?.packageJSON?.contributes
                ?.configuration?.properties ?? {}
        );
    }

    private getPackageNls(): Record<string, string> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            return require("../../package.nls.json") as Record<string, string>;
        } catch {
            return {};
        }
    }

    private resolvePackageString(value: unknown, packageNls: Record<string, string>): string {
        if (typeof value !== "string") {
            return "";
        }
        const match = /^%(.+)%$/.exec(value);
        return match ? (packageNls[match[1]] ?? value) : value;
    }

    private getMssqlSettings(): Record<string, unknown> {
        const settings: Record<string, unknown> = {};
        const configuration = vscode.workspace.getConfiguration();

        for (const key of Object.keys(this.getMssqlConfigurationProperties())) {
            if (key === Constants.configQuickQueries || key === Constants.configShortcuts) {
                continue;
            }
            settings[key] = configuration.get(key);
        }

        return settings;
    }

    private getMssqlSettingDefinitions(): MssqlSettingDefinition[] {
        const packageNls = this.getPackageNls();
        return Object.entries(this.getMssqlConfigurationProperties())
            .filter(
                ([key]) =>
                    key !== Constants.configQuickQueries && key !== Constants.configShortcuts,
            )
            .map(([key, schema]) => {
                const enumValues = Array.isArray(schema.enum)
                    ? schema.enum.map((value: unknown) => String(value))
                    : undefined;
                const enumDescriptions = Array.isArray(schema.enumDescriptions)
                    ? schema.enumDescriptions.map((description: unknown) =>
                          this.resolvePackageString(description, packageNls),
                      )
                    : undefined;

                return {
                    key,
                    label: this.getSettingLabel(key),
                    description: this.resolvePackageString(schema.description, packageNls),
                    group: this.getSettingGroup(key),
                    inputType: this.getSettingInputType(schema),
                    enumValues,
                    enumDescriptions,
                    defaultValue: schema.default,
                    scope: schema.scope,
                };
            });
    }

    private getSettingInputType(schema: any): MssqlSettingInputType {
        const schemaTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
        if (schemaTypes.includes("boolean") && schemaTypes.includes("null")) {
            return "nullableBoolean";
        }
        if (schemaTypes.includes("boolean")) {
            return "boolean";
        }
        if (schemaTypes.includes("number")) {
            return "number";
        }
        if (schemaTypes.includes("string") || Array.isArray(schema.enum)) {
            return "string";
        }
        return "json";
    }

    private getSettingLabel(key: string): string {
        const withoutPrefix = key.replace(/^mssql\./, "");
        return withoutPrefix
            .split(".")
            .map((part) =>
                part
                    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
                    .replace(/\b\w/g, (letter) => letter.toUpperCase()),
            )
            .join(" / ");
    }

    private getSettingGroup(key: string): string {
        if (key.startsWith("mssql.connection") || key === "mssql.azureActiveDirectory") {
            return "Connections";
        }
        if (key.startsWith("mssql.objectExplorer")) {
            return "Object Explorer";
        }
        if (key.startsWith("mssql.resultsGrid")) {
            return "Results Grid";
        }
        if (
            key.startsWith("mssql.results") ||
            key.startsWith("mssql.saveAsCsv") ||
            key.startsWith("mssql.copy")
        ) {
            return "Query Results";
        }
        if (key.startsWith("mssql.query.")) {
            return "Query Execution";
        }
        if (key.startsWith("mssql.format.")) {
            return "Formatting";
        }
        if (
            key.startsWith("mssql.intelliSense.") ||
            key === "mssql.autoDisableNonTSqlLanguageService"
        ) {
            return "IntelliSense";
        }
        if (key.includes("History")) {
            return "Query History";
        }
        if (key.startsWith("mssql.profiler")) {
            return "Profiler";
        }
        if (
            key.startsWith("mssql.log") ||
            key === "mssql.tracingLevel" ||
            key === "mssql.piiLogging"
        ) {
            return "Logging";
        }
        if (key.startsWith("mssql.statusBar")) {
            return "Status Bar";
        }
        if (key.startsWith("mssql.schemaDesigner")) {
            return "Schema Designer";
        }
        return "General";
    }

    private async updateMssqlSettings(settings: Record<string, unknown>): Promise<void> {
        const definitions = this.getMssqlSettingDefinitions();
        const configuration = vscode.workspace.getConfiguration();

        for (const definition of definitions) {
            if (!Object.prototype.hasOwnProperty.call(settings, definition.key)) {
                continue;
            }

            if (
                this.areSettingValuesEqual(
                    configuration.get(definition.key),
                    settings[definition.key],
                )
            ) {
                continue;
            }

            await configuration.update(
                definition.key,
                settings[definition.key],
                vscode.ConfigurationTarget.Global,
            );
        }
    }

    private areSettingValuesEqual(left: unknown, right: unknown): boolean {
        return JSON.stringify(left) === JSON.stringify(right);
    }
}
