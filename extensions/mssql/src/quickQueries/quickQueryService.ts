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
    constructor(private readonly dependencies: QuickQueryExecutionDependencies) {}

    public async run(slotNumber: number): Promise<QuickQueryRunResult> {
        if (slotNumber < 1 || slotNumber > quickQueryCount) {
            throw new Error(Loc.quickQuerySlotOutOfRange(quickQueryCount));
        }

        const slot = getQuickQuerySlot(this.dependencies.readQuickQueries(), slotNumber);
        if (slot.query.trim().length === 0) {
            this.dependencies.openConfiguration(slotNumber);
            return QuickQueryRunResult.OpenedConfiguration;
        }

        const editor = await this.dependencies.createSqlEditor({
            content: slot.query,
            ...resolveQuickQueryConnectionOptions(),
        });

        if (slot.executionMode === QuickQueryExecutionMode.Open) {
            return QuickQueryRunResult.Opened;
        }

        if (!this.dependencies.isSqlEditorConnected(editor)) {
            return QuickQueryRunResult.OpenedWithoutConnection;
        }

        await this.dependencies.runSqlEditorQuery(editor);
        return QuickQueryRunResult.OpenedAndRan;
    }
}
