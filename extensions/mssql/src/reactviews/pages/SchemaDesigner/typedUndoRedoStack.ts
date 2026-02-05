/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    SchemaDesignerAction,
    BatchEditAction,
    EditSource,
    ActionFactory,
} from "./schemaDesignerUndoActions";

export interface TypedUndoRedoStackOptions {
    /** Maximum number of actions to keep in history */
    maxSize?: number;
}

/**
 * A typed undo/redo stack that stores action deltas instead of full state snapshots.
 * Supports batching actions together (e.g., for AI/Copilot edits).
 */
export class TypedUndoRedoStack {
    private undoStack: SchemaDesignerAction[] = [];
    private redoStack: SchemaDesignerAction[] = [];
    private maxSize: number;

    // Batch mode state
    private currentBatch: SchemaDesignerAction[] | null = null;
    private currentBatchSource: EditSource = "user";
    private currentBatchSessionId: string | null = null;
    private currentBatchDescription: string | undefined;

    constructor(options: TypedUndoRedoStackOptions = {}) {
        this.maxSize = options.maxSize ?? 100;
    }

    /**
     * Start collecting actions into a batch.
     * All actions pushed while in batch mode will be grouped into a single undo entry.
     *
     * @param source - The source of the edits (user, copilot, import)
     * @param sessionId - Unique ID for this batch (for later identification)
     * @param description - Human-readable description of the batch
     */
    startBatch(source: EditSource, sessionId: string, description?: string): void {
        if (this.currentBatch !== null) {
            // Already in batch mode - end the current batch first
            this.endBatch();
        }
        this.currentBatch = [];
        this.currentBatchSource = source;
        this.currentBatchSessionId = sessionId;
        this.currentBatchDescription = description;
    }

    /**
     * End the current batch and push it as a single undo entry.
     * If no actions were collected, no entry is created.
     *
     * @param description - Optional description to override the one set in startBatch
     */
    endBatch(description?: string): void {
        if (this.currentBatch === null) {
            return;
        }

        if (this.currentBatch.length > 0) {
            const batchAction = ActionFactory.batchEdit(
                this.currentBatch,
                this.currentBatchSource,
                this.currentBatchSessionId ?? undefined,
                description ?? this.currentBatchDescription,
            );
            this.pushActionInternal(batchAction);
        }

        this.currentBatch = null;
        this.currentBatchSessionId = null;
        this.currentBatchDescription = undefined;
    }

    /**
     * Check if currently collecting actions into a batch.
     */
    isInBatchMode(): boolean {
        return this.currentBatch !== null;
    }

    /**
     * Get the current batch session ID (if in batch mode).
     */
    getCurrentBatchSessionId(): string | null {
        return this.currentBatchSessionId;
    }

    /**
     * Push an action onto the undo stack.
     * If in batch mode, the action is added to the current batch instead.
     *
     * @param action - The action to push
     */
    pushAction(action: SchemaDesignerAction): void {
        if (this.currentBatch !== null && action.type !== "batchEdit") {
            // In batch mode - add to current batch
            this.currentBatch.push(action);
            return;
        }

        this.pushActionInternal(action);
    }

    /**
     * Internal method to push an action directly to the undo stack.
     */
    private pushActionInternal(action: SchemaDesignerAction): void {
        this.undoStack.push(action);
        this.redoStack = []; // Clear redo stack on new action

        // Trim the stack if it exceeds the maximum size
        while (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
    }

    /**
     * Check if undo is available.
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo is available.
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Peek at the top action on the undo stack without removing it.
     */
    peekUndo(): SchemaDesignerAction | undefined {
        return this.undoStack[this.undoStack.length - 1];
    }

    /**
     * Peek at the top action on the redo stack without removing it.
     */
    peekRedo(): SchemaDesignerAction | undefined {
        return this.redoStack[this.redoStack.length - 1];
    }

    /**
     * Pop and return the top action from the undo stack.
     * The action is moved to the redo stack.
     */
    popUndo(): SchemaDesignerAction | undefined {
        const action = this.undoStack.pop();
        if (action) {
            this.redoStack.push(action);
        }
        return action;
    }

    /**
     * Pop and return the top action from the redo stack.
     * The action is moved to the undo stack.
     */
    popRedo(): SchemaDesignerAction | undefined {
        const action = this.redoStack.pop();
        if (action) {
            this.undoStack.push(action);
        }
        return action;
    }

    /**
     * Get all actions from a specific source (e.g., all Copilot edits).
     */
    getActionsBySource(source: EditSource): SchemaDesignerAction[] {
        return this.undoStack.filter((a) => a.source === source);
    }

    /**
     * Get all actions from a specific session.
     */
    getActionsBySession(sessionId: string): SchemaDesignerAction[] {
        return this.undoStack.filter((a) => a.sessionId === sessionId);
    }

    /**
     * Get all batch actions from Copilot.
     */
    getCopilotBatches(): BatchEditAction[] {
        return this.undoStack.filter(
            (a): a is BatchEditAction => a.type === "batchEdit" && a.source === "copilot",
        );
    }

    /**
     * Undo all actions from a specific session.
     * Returns the actions that were undone (in the order they should be executed).
     *
     * @param sessionId - The session ID to undo
     */
    undoSession(sessionId: string): SchemaDesignerAction[] {
        const toUndo: SchemaDesignerAction[] = [];

        // Pop from top until we've removed all actions with this sessionId
        // that are at the top of the stack (we can only undo continuous blocks)
        while (this.undoStack.length > 0) {
            const top = this.undoStack[this.undoStack.length - 1];
            if (top.sessionId === sessionId) {
                const action = this.popUndo();
                if (action) {
                    toUndo.push(action);
                }
            } else {
                break;
            }
        }

        return toUndo;
    }

    /**
     * Undo all actions from a specific source.
     * Returns the actions that were undone (in the order they should be executed).
     * Note: This only undoes continuous blocks at the top of the stack.
     *
     * @param source - The source to undo (e.g., 'copilot')
     */
    undoBySource(source: EditSource): SchemaDesignerAction[] {
        const toUndo: SchemaDesignerAction[] = [];

        while (this.undoStack.length > 0) {
            const top = this.undoStack[this.undoStack.length - 1];
            if (top.source === source) {
                const action = this.popUndo();
                if (action) {
                    toUndo.push(action);
                }
            } else {
                break;
            }
        }

        return toUndo;
    }

    /**
     * Clear all history (undo and redo stacks).
     */
    clearHistory(): void {
        this.undoStack = [];
        this.redoStack = [];
        this.currentBatch = null;
        this.currentBatchSessionId = null;
        this.currentBatchDescription = undefined;
    }

    /**
     * Get the current stack sizes.
     */
    getStackSizes(): { undoSize: number; redoSize: number } {
        return {
            undoSize: this.undoStack.length,
            redoSize: this.redoStack.length,
        };
    }

    /**
     * Get a summary of recent actions for debugging/UI display.
     */
    getActionSummary(limit: number = 10): Array<{
        type: string;
        source: EditSource;
        sessionId?: string;
        description?: string;
        timestamp: number;
    }> {
        return this.undoStack.slice(-limit).map((action) => ({
            type: action.type,
            source: action.source,
            sessionId: action.sessionId,
            description: action.type === "batchEdit" ? action.description : undefined,
            timestamp: action.timestamp,
        }));
    }
}

/**
 * Global instance of the typed undo/redo stack for the schema designer.
 */
export const typedActionStack = new TypedUndoRedoStack({ maxSize: 100 });
