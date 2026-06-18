/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BridgePlatformContext } from "./contracts";

export interface SqlToolsMcpRegisteredConnection {
    connectionHandle: string;
    ownerUri: string;
    platformContext: BridgePlatformContext;
    disposed: boolean;
    queryTail: Promise<void>;
}

export class SqlToolsMcpConnectionRegistry {
    private readonly registeredConnections = new Map<string, SqlToolsMcpRegisteredConnection>();

    get(connectionName: string): SqlToolsMcpRegisteredConnection | undefined {
        return this.registeredConnections.get(connectionName);
    }

    set(connectionName: string, context: SqlToolsMcpRegisteredConnection): void {
        this.registeredConnections.set(connectionName, context);
    }

    delete(connectionName: string): boolean {
        return this.registeredConnections.delete(connectionName);
    }

    values(): IterableIterator<SqlToolsMcpRegisteredConnection> {
        return this.registeredConnections.values();
    }

    clear(): void {
        this.registeredConnections.clear();
    }
}

export const sqlToolsMcpConnectionRegistry = new SqlToolsMcpConnectionRegistry();
