/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import {
    normalizeQuickQueries,
    quickQueryCount,
    QuickQueryExecutionMode,
    QuickQuerySlot,
} from "../sharedInterfaces/shortcutsConfiguration";
import { ConnectionStrategy, NewQueryOptions } from "../controllers/sqlDocumentService";
import * as Loc from "../constants/locConstants";

export enum QuickQueryRunResult {
    OpenedConfiguration = "openedConfiguration",
    Opened = "opened",
    OpenedAndRan = "openedAndRan",
    OpenedWithoutConnection = "openedWithoutConnection",
}

export interface QuickQueryExecutionDependencies {
    readQuickQueries: () => QuickQuerySlot[];
    openConfiguration: (focusedQuickQuerySlot?: number) => void;
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

        const editor = await dependencies.createSqlEditor({
            content: slot.query,
            ...resolveQuickQueryConnectionOptions(),
        });

        if (slot.executionMode === QuickQueryExecutionMode.Open) {
            return QuickQueryRunResult.Opened;
        }

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
