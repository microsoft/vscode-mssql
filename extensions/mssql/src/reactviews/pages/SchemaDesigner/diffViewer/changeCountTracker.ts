/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SchemaDesigner } from "../../../../sharedInterfaces/schemaDesigner";

type ChangeCountCallback = (counts: SchemaDesigner.ChangeCountSummary) => void;

/**
 * Lightweight tracker for schema change counts.
 *
 * Tracks additions, modifications, and deletions incrementally without
 * requiring full diff calculation. Used by the toolbar button to display
 * real-time change counts.
 *
 * Implements the IChangeCountTracker interface from the contracts.
 */
export class ChangeCountTracker {
    private _additions: number = 0;
    private _modifications: number = 0;
    private _deletions: number = 0;
    private _subscribers: Set<ChangeCountCallback> = new Set();

    /**
     * Get the current change count summary
     */
    public getCounts(): SchemaDesigner.ChangeCountSummary {
        return {
            additions: this._additions,
            modifications: this._modifications,
            deletions: this._deletions,
            total: this._additions + this._modifications + this._deletions,
        };
    }

    /**
     * Increment count for a specific change type
     * @param changeType Type of change to increment
     */
    public increment(changeType: SchemaDesigner.SchemaChangeType): void {
        switch (changeType) {
            case SchemaDesigner.SchemaChangeType.Addition:
                this._additions++;
                break;
            case SchemaDesigner.SchemaChangeType.Modification:
                this._modifications++;
                break;
            case SchemaDesigner.SchemaChangeType.Deletion:
                this._deletions++;
                break;
        }
        this._notifySubscribers();
    }

    /**
     * Decrement count for a specific change type
     * @param changeType Type of change to decrement
     */
    public decrement(changeType: SchemaDesigner.SchemaChangeType): void {
        switch (changeType) {
            case SchemaDesigner.SchemaChangeType.Addition:
                this._additions = Math.max(0, this._additions - 1);
                break;
            case SchemaDesigner.SchemaChangeType.Modification:
                this._modifications = Math.max(0, this._modifications - 1);
                break;
            case SchemaDesigner.SchemaChangeType.Deletion:
                this._deletions = Math.max(0, this._deletions - 1);
                break;
        }
        this._notifySubscribers();
    }

    /**
     * Reset all counts to zero
     */
    public reset(): void {
        this._additions = 0;
        this._modifications = 0;
        this._deletions = 0;
        this._notifySubscribers();
    }

    /**
     * Set counts directly from a diff calculation result
     * @param summary The summary to apply
     */
    public setFromSummary(summary: SchemaDesigner.ChangeCountSummary): void {
        this._additions = summary.additions;
        this._modifications = summary.modifications;
        this._deletions = summary.deletions;
        this._notifySubscribers();
    }

    /**
     * Subscribe to count changes
     * @param callback Function called when counts change
     * @returns Unsubscribe function
     */
    public subscribe(callback: ChangeCountCallback): () => void {
        this._subscribers.add(callback);
        // Immediately notify with current state
        callback(this.getCounts());
        return () => {
            this._subscribers.delete(callback);
        };
    }

    /**
     * Notify all subscribers of count changes
     */
    private _notifySubscribers(): void {
        const counts = this.getCounts();
        this._subscribers.forEach((callback) => {
            callback(counts);
        });
    }
}

/**
 * Singleton instance for the change count tracker.
 * Allows shared access across components without prop drilling.
 */
let globalTrackerInstance: ChangeCountTracker | undefined = undefined;

/**
 * Get the global ChangeCountTracker instance
 */
export function getChangeCountTracker(): ChangeCountTracker {
    if (!globalTrackerInstance) {
        globalTrackerInstance = new ChangeCountTracker();
    }
    return globalTrackerInstance;
}

/**
 * Reset the global tracker instance (useful for testing)
 */
export function resetChangeCountTracker(): void {
    if (globalTrackerInstance) {
        globalTrackerInstance.reset();
    }
    globalTrackerInstance = undefined;
}
