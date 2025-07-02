/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { ToolBase } from "./toolBase";
import ConnectionManager from "../../controllers/connectionManager";
import * as Constants from "../../constants/constants";
import { MssqlChatAgent as loc } from "../../constants/locConstants";
import { getErrorMessage } from "../../utils/utils";
import { randomUUID } from "crypto";

/** Parameters for the connect tool. */
export interface ConnectToolParams {
    profileId?: string;
    serverName?: string;
    database?: string;
}

/** Result of the connect tool. */
export interface ConnectToolResult {
    success: boolean;
    connectionId: string;
    message?: string;
}

/** Types of connection profile matches found during the workflow. */
export enum ConnectionMatchType {
    ProfileId = "profileId",
    ProfileNotFound = "profileNotFound",
    ExactMatch = "exactMatch",
    ServerMatch = "serverMatch",
    NoServerMatch = "noServerMatch",
    InvalidInput = "invalidInput",
}

export class ConnectTool extends ToolBase<ConnectToolParams> {
    public readonly toolName = Constants.copilotConnectToolName;

    constructor(private connectionManager: ConnectionManager) {
        super();
    }

    /**
     * Finds a connection profile based on the workflow:
     * 1. If profileId is provided, use that saved connection profile directly
     * 2. If serverName/database combo is provided:
     *    a) Look for exact match in saved connections and use it
     *    b) If no exact match, look for saved connection with same server but different database
     *    c) If no saved connection with same server exists, return null
     */
    private async findConnectionWithProperties(
        profileId?: string,
        serverName?: string,
        database?: string,
    ) {
        const profiles = await this.connectionManager.connectionStore.readAllConnections();

        // 1. If profileId is provided, use that saved connection profile directly
        if (profileId) {
            const profile = profiles.find((p) => p.id === profileId);
            if (profile) {
                return { profile, matchType: ConnectionMatchType.ProfileId };
            }
            return { profile: undefined, matchType: ConnectionMatchType.ProfileNotFound };
        }

        // 2. If serverName is provided, look for saved connections
        if (serverName) {
            // 2a. Look for exact match (same server and database)
            if (database) {
                const exactMatch = profiles.find(
                    (p) => p.server === serverName && p.database === database,
                );
                if (exactMatch) {
                    return { profile: exactMatch, matchType: ConnectionMatchType.ExactMatch };
                }
            }

            // 2b. Look for saved connection with same server but different (or no specified) database
            const serverMatch = profiles.find((p) => p.server === serverName);
            if (serverMatch) {
                return { profile: serverMatch, matchType: ConnectionMatchType.ServerMatch };
            }

            // 2c. No saved connection with same server exists
            return { profile: undefined, matchType: ConnectionMatchType.NoServerMatch };
        }

        return { profile: undefined, matchType: ConnectionMatchType.InvalidInput };
    }

    async call(
        options: vscode.LanguageModelToolInvocationOptions<ConnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { profileId, serverName, database } = options.input;

        // Find the appropriate connection profile using our workflow
        const result = await this.findConnectionWithProperties(profileId, serverName, database);
        if (!result.profile) {
            let errorMessage: string;
            switch (result.matchType) {
                case ConnectionMatchType.ProfileNotFound:
                    errorMessage = loc.connectToolProfileNotFoundError(profileId!);
                    break;
                case ConnectionMatchType.NoServerMatch:
                    errorMessage = loc.connectToolServerNotFoundError(serverName!);
                    break;
                case ConnectionMatchType.InvalidInput:
                    errorMessage = loc.connectToolInvalidInputError();
                    break;
                default:
                    errorMessage = loc.connectToolFailMessage;
            }
            return JSON.stringify({
                message: errorMessage,
                success: false,
            } as ConnectToolResult);
        }

        // Determine the database to use
        const targetDatabase = database || result.profile.database;
        let connectionId = randomUUID();

        let success: boolean;
        let message: string;
        try {
            let connInfo = result.profile;
            const handlePwdResult =
                await this.connectionManager.handlePasswordBasedCredentials(connInfo);
            if (handlePwdResult) {
                success = await this.connectionManager.connect(connectionId, {
                    ...connInfo,
                    database: targetDatabase,
                });
            } else {
                success = false;
            }
            message = success ? loc.connectToolSuccessMessage : loc.connectToolFailMessage;
        } catch (err) {
            success = false;
            message = getErrorMessage(err);
        }
        return JSON.stringify({ success, connectionId, message } as ConnectToolResult);
    }

    async prepareInvocation(
        options: vscode.LanguageModelToolInvocationPrepareOptions<ConnectToolParams>,
        _token: vscode.CancellationToken,
    ) {
        const { profileId, serverName, database } = options.input;

        let confirmationText: string;
        let invocationMessage: string;

        if (profileId) {
            confirmationText = loc.connectToolConfirmationMessageWithProfile(profileId);
            invocationMessage = loc.connectToolInvocationMessageWithProfile(profileId);
        } else {
            confirmationText = database
                ? loc.connectToolConfirmationMessageWithServerAndDatabase(serverName!, database)
                : loc.connectToolConfirmationMessageWithServerOnly(serverName!);
            invocationMessage = database
                ? loc.connectToolInvocationMessageWithServerAndDatabase(serverName!, database)
                : loc.connectToolInvocationMessageWithServerOnly(serverName!);
        }

        const confirmationMessages = {
            title: `${Constants.extensionName}: ${loc.connectToolConfirmationTitle}`,
            message: new vscode.MarkdownString(confirmationText),
        };

        return { invocationMessage, confirmationMessages };
    }
}
