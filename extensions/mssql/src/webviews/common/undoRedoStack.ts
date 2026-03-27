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
        this.currentState = state;
        this.clearHistory();
    }

    /**
     * Push a new state onto the stack
     * @param newState - The new state to push
     * @param undoAction - Optional custom undo action
     */
    pushState(newState: T, undoAction?: () => T): void {
        const previousState = this.currentState;

        // Do a deep comparison to check if the state has changed
        if (JSON.stringify(previousState) === JSON.stringify(newState)) {
            // No change, do not push to stack
            return;
        }

        // Store the action that can undo/redo this change
        this.undoStack.push({
            undo: undoAction || (() => previousState as T),
            redo: () => newState,
        });

        // Update current state
        this.currentState = newState;

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
        const prevState = action.undo();

        const current = this.currentState;
        this.redoStack.push({
            undo: () => current as T, // capture at time of undo
            redo: action.redo,
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
        const nextState = action.redo();

        const current = this.currentState;
        this.undoStack.push({
            undo: () => current as T,
            redo: () => nextState,
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
