/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SimpleUndoRedoStack - A lightweight TypeScript implementation of an undo/redo system
 *
 * This version avoids deep object cloning and comparison for better performance,
 * assuming state objects are treated as immutable.
 */
export class UndoRedoStack<T> {
    private undoStack: Array<UndoRedoAction<T>> = [];
    private redoStack: Array<UndoRedoAction<T>> = [];
    private maxSize: number;
    private currentState: T | null = null;

    /**
     * Create a new SimpleUndoRedoStack instance
     * @param maxSize - Maximum number of states to remember (optional)
     */
    constructor(maxSize: number = 100) {
        this.maxSize = maxSize;
    }

    private cloneState(state: T): T {
        // ReactFlow state objects are frequently mutated in-place.
        // Clone defensively so history entries remain stable.
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sc = (globalThis as any).structuredClone as undefined | ((v: T) => T);
            if (typeof sc === "function") {
                return sc(state);
            }
        } catch {
            // Fall through to JSON clone
        }

        return JSON.parse(JSON.stringify(state)) as T;
    }

    /**
     * Get the current state
     */
    getCurrentState(): T | null {
        return this.currentState;
    }

    /**
     * Set the initial state (without pushing to the stack)
     */
    setInitialState(state: T): void {
        this.currentState = this.cloneState(state);
        this.clearHistory();
    }

    /**
     * Push a new state onto the stack
     * @param newState - The new state to push
     * @param undoAction - Optional custom undo action
     */
    pushState(newState: T, undoAction?: () => T): void {
        const previousState = this.currentState;

        const nextStateClone = this.cloneState(newState);
        const previousStateClone = previousState ? this.cloneState(previousState) : previousState;

        // Do a deep comparison to check if the state has changed
        if (JSON.stringify(previousStateClone) === JSON.stringify(nextStateClone)) {
            // No change, do not push to stack
            return;
        }

        // Store the action that can undo/redo this change
        this.undoStack.push({
            undo: undoAction
                ? () => this.cloneState(undoAction())
                : () => (previousStateClone as T),
            redo: () => nextStateClone,
        });

        // Update current state
        this.currentState = nextStateClone;

        // Clear the redo stack as a new action breaks the redo chain
        this.redoStack = [];

        // Trim the stack if it exceeds the maximum size
        if (this.undoStack.length > this.maxSize) {
            this.undoStack.shift();
        }
    }

    /**
     * Check if undo operation is available
     */
    canUndo(): boolean {
        return this.undoStack.length > 0;
    }

    /**
     * Check if redo operation is available
     */
    canRedo(): boolean {
        return this.redoStack.length > 0;
    }

    /**
     * Perform an undo operation
     * @returns The previous state, or null if cannot undo
     */
    undo(): T | null {
        if (!this.canUndo()) {
            return null;
        }

        const action = this.undoStack.pop()!;
        const prevState = this.cloneState(action.undo());

        const current = this.currentState;
        this.redoStack.push({
            undo: () => this.cloneState(current as T), // capture at time of undo
            redo: () => this.cloneState(action.redo()),
        });

        this.currentState = prevState;
        return prevState;
    }

    /**
     * Perform a redo operation
     * @returns The next state, or null if cannot redo
     */
    redo(): T | null {
        if (!this.canRedo()) {
            return null;
        }

        const action = this.redoStack.pop()!;
        const nextState = this.cloneState(action.redo());

        const current = this.currentState;
        this.undoStack.push({
            undo: () => this.cloneState(current as T),
            redo: () => this.cloneState(nextState),
        });

        this.currentState = nextState;
        return nextState;
    }

    /**
     * Clear all history (undo and redo stacks)
     */
    clearHistory(): void {
        this.undoStack = [];
        this.redoStack = [];
    }

    /**
     * Get the current stack sizes
     */
    getStackSizes(): { undoSize: number; redoSize: number } {
        return {
            undoSize: this.undoStack.length,
            redoSize: this.redoStack.length,
        };
    }
}

/**
 * Interface for an action that can be undone/redone
 */
export interface UndoRedoAction<T> {
    undo: () => T;
    redo: () => T;
}
