/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    normalizeQuickQueries,
    quickQueryCount,
    QuickQuerySlot,
} from "../sharedInterfaces/shortcutsConfiguration";
import { ConnectionStrategy, NewQueryOptions } from "../controllers/sqlDocumentService";
import * as Loc from "../constants/locConstants";

export enum QuickQueryRunResult {
    OpenedConfiguration = "openedConfiguration",
    Executed = "executed",
    OpenedAndRan = "openedAndRan",
    OpenedWithoutConnection = "openedWithoutConnection",
    ConnectionUnavailable = "connectionUnavailable",
    MultipleSelectionsNotSupported = "multipleSelectionsNotSupported",
    SelectedTextRequired = "selectedTextRequired",
}

export interface QuickQueryExecutionDependencies {
    readQuickQueries: () => QuickQuerySlot[];
    openConfiguration: (focusedQuickQuerySlot?: number) => void;
    getActiveSqlEditor: () => vscode.TextEditor | undefined;
    ensureSqlEditorConnected: (editor: vscode.TextEditor) => Promise<boolean>;
    runSqlEditorQueryString: (editor: vscode.TextEditor, query: string) => Promise<void>;
    showMultipleSelectionsError: () => void;
    showSelectedTextRequiredError: () => void;
    createSqlEditor: (options: NewQueryOptions) => Promise<vscode.TextEditor>;
    isSqlEditorConnected: (editor: vscode.TextEditor) => boolean;
    runSqlEditorQuery: (editor: vscode.TextEditor) => Promise<void>;
}

export function getQuickQuerySlot(slots: QuickQuerySlot[], slotNumber: number): QuickQuerySlot {
    return normalizeQuickQueries(slots)[slotNumber - 1];
}

export function resolveQuickQueryConnectionOptions(): Pick<NewQueryOptions, "connectionStrategy"> {
    return {
        connectionStrategy: ConnectionStrategy.PromptForConnection,
    };
}

const quickQueryArgumentToken = "{arg}";

export function hasQuickQueryArgument(query: string): boolean {
    return query.includes(quickQueryArgumentToken);
}

/**
 * Applies the selected editor text to a Quick Query. Explicit argument tokens take precedence;
 * otherwise, the selection is appended exactly as entered for Azure Data Studio compatibility.
 */
export function composeQuickQuery(query: string, selectedText: string): string {
    const hasArgumentToken = hasQuickQueryArgument(query);
    if (!hasArgumentToken) {
        return query + selectedText;
    }

    return query.replaceAll(quickQueryArgumentToken, () => selectedText);
}

export class QuickQueryService {
    private static _instance: QuickQueryService;
    private dependencies: QuickQueryExecutionDependencies | undefined;

    private constructor() {}

    public static getInstance(): QuickQueryService {
        if (!QuickQueryService._instance) {
            QuickQueryService._instance = new QuickQueryService();
        }
        return QuickQueryService._instance;
    }

    public configure(dependencies: QuickQueryExecutionDependencies): void {
        this.dependencies = dependencies;
    }

    public async run(slotNumber: number): Promise<QuickQueryRunResult> {
        const dependencies = this.getDependencies();
        if (slotNumber < 1 || slotNumber > quickQueryCount) {
            throw new Error(Loc.quickQuerySlotOutOfRange(quickQueryCount));
        }

        const slot = getQuickQuerySlot(dependencies.readQuickQueries(), slotNumber);
        if (slot.query.trim().length === 0) {
            dependencies.openConfiguration(slotNumber);
            return QuickQueryRunResult.OpenedConfiguration;
        }

        const activeEditor = dependencies.getActiveSqlEditor();
        if (activeEditor) {
            if (activeEditor.selections.length > 1) {
                dependencies.showMultipleSelectionsError();
                return QuickQueryRunResult.MultipleSelectionsNotSupported;
            }

            const selectedText = activeEditor.selection.isEmpty
                ? ""
                : activeEditor.document.getText(activeEditor.selection);
            if (hasQuickQueryArgument(slot.query) && selectedText.length === 0) {
                dependencies.showSelectedTextRequiredError();
                return QuickQueryRunResult.SelectedTextRequired;
            }
            const query = composeQuickQuery(slot.query, selectedText);
            if (!(await dependencies.ensureSqlEditorConnected(activeEditor))) {
                return QuickQueryRunResult.ConnectionUnavailable;
            }

            await dependencies.runSqlEditorQueryString(activeEditor, query);
            return QuickQueryRunResult.Executed;
        }

        if (hasQuickQueryArgument(slot.query)) {
            dependencies.showSelectedTextRequiredError();
            return QuickQueryRunResult.SelectedTextRequired;
        }

        const editor = await dependencies.createSqlEditor({
            content: composeQuickQuery(slot.query, ""),
            ...resolveQuickQueryConnectionOptions(),
        });

        if (!dependencies.isSqlEditorConnected(editor)) {
            return QuickQueryRunResult.OpenedWithoutConnection;
        }

        await dependencies.runSqlEditorQuery(editor);
        return QuickQueryRunResult.OpenedAndRan;
    }

    private getDependencies(): QuickQueryExecutionDependencies {
        if (!this.dependencies) {
            throw new Error("QuickQueryService has not been configured.");
        }

        return this.dependencies;
    }
}

export const quickQueryService = QuickQueryService.getInstance();
