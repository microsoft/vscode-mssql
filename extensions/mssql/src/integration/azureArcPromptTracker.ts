/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { uuid } from "../utils/utils";

const storageKey = "mssql.fabricDatabaseHub.azureArcPrompts";

const dayInMilliseconds = 24 * 60 * 60 * 1000;

/** How long a prompt waits for its server to be connected to Azure Arc before it's forgotten. */
const promptLifetimeInMilliseconds = 90 * dayInMilliseconds;

/** How often a prompted server is checked again when it's connected to. */
const backgroundCheckIntervalInMilliseconds = dayInMilliseconds;

/** A prompt to connect a SQL Server to Azure Arc, kept until the server is found connected. */
export interface AzureArcPrompt {
    /**
     * Random ID that joins the prompt's telemetry to the telemetry of the server later turning up
     * connected to Azure Arc.  It carries nothing about the server or the user.
     */
    promptId: string;
    /** When the user was first prompted, in milliseconds since the epoch. */
    promptedAt: number;
    /** How many times the user has been prompted for the server. */
    promptCount: number;
    /** Whether the user ever opened the guide to connecting the server. */
    learnHowOpened: boolean;
    /** When the server was last checked in the background, in milliseconds since the epoch. */
    lastCheckedAt?: number;
}

/**
 * Remembers which connections the user was prompted to connect to Azure Arc, keyed by connection
 * ID, so the prompt can be credited when the server later turns up connected.
 *
 * Only the random prompt ID and counters are kept; nothing identifies the server.
 */
export class AzureArcPromptTracker {
    constructor(
        private readonly _state: vscode.Memento,
        private readonly _now: () => number = () => Date.now(),
    ) {}

    /**
     * Records that the user was prompted for a connection.  A repeat prompt keeps the first
     * prompt's ID and date, so every prompt for the server joins the same funnel.
     */
    public async recordPrompt(
        connectionId: string,
        learnHowOpened: boolean,
    ): Promise<AzureArcPrompt> {
        const prompts = this.getPrompts();
        const previous = prompts[connectionId];
        const prompt: AzureArcPrompt = previous
            ? {
                  ...previous,
                  promptCount: previous.promptCount + 1,
                  learnHowOpened: previous.learnHowOpened || learnHowOpened,
              }
            : { promptId: uuid(), promptedAt: this._now(), promptCount: 1, learnHowOpened };
        prompts[connectionId] = prompt;
        await this._state.update(storageKey, prompts);
        return prompt;
    }

    /** Removes a connection's prompt once its server is found connected to Azure Arc. */
    public async completePrompt(connectionId: string): Promise<AzureArcPrompt | undefined> {
        const prompts = this.getPrompts();
        const prompt = prompts[connectionId];
        if (!prompt) {
            return undefined;
        }

        delete prompts[connectionId];
        await this._state.update(storageKey, prompts);
        return prompt;
    }

    /**
     * Claims a background check of a prompted connection's server, at most once a day.
     *
     * @returns the connection's prompt when a check is due, or undefined when it isn't.
     */
    public async claimBackgroundCheck(connectionId: string): Promise<AzureArcPrompt | undefined> {
        const prompts = this.getPrompts();
        const prompt = prompts[connectionId];
        const now = this._now();
        if (!prompt || now - (prompt.lastCheckedAt ?? 0) < backgroundCheckIntervalInMilliseconds) {
            return undefined;
        }

        prompts[connectionId] = { ...prompt, lastCheckedAt: now };
        await this._state.update(storageKey, prompts);
        return prompt;
    }

    /** Whole days since the user was first prompted. */
    public getDaysSincePrompt(prompt: AzureArcPrompt): number {
        return Math.floor((this._now() - prompt.promptedAt) / dayInMilliseconds);
    }

    /** Returns the stored prompts, leaving out any that have outlived their wait. */
    private getPrompts(): Record<string, AzureArcPrompt> {
        const now = this._now();
        return Object.fromEntries(
            Object.entries(this._state.get<Record<string, AzureArcPrompt>>(storageKey, {})).filter(
                ([, prompt]) => now - prompt.promptedAt < promptLifetimeInMilliseconds,
            ),
        );
    }
}
