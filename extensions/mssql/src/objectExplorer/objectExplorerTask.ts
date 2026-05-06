/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { TreeNodeInfo } from "./nodes/treeNodeInfo";
import { uuid } from "../utils/utils";

export enum ObjectExplorerTaskKind {
    Connect = "connect",
    Expand = "expand",
}

export interface ObjectExplorerTask {
    id: string;
    kind: ObjectExplorerTaskKind;
    node: TreeNodeInfo;
    token: vscode.CancellationToken;
    serviceTaskId?: string;
    sessionId?: string;
    nodePath?: string;
}

interface ObjectExplorerTaskRegistration {
    task: ObjectExplorerTask;
    cancellationSource: vscode.CancellationTokenSource;
    onCancel?: (task: ObjectExplorerTask) => Promise<void> | void;
}

export class ObjectExplorerTaskManager {
    private readonly _tasks = new Map<string, ObjectExplorerTaskRegistration>();

    public create(options: {
        kind: ObjectExplorerTaskKind;
        node: TreeNodeInfo;
        onCancel?: (task: ObjectExplorerTask) => Promise<void> | void;
    }): ObjectExplorerTask {
        const cancellationSource = new vscode.CancellationTokenSource();
        const task: ObjectExplorerTask = {
            id: `oe-${options.kind}-${uuid()}`,
            kind: options.kind,
            node: options.node,
            token: cancellationSource.token,
            sessionId: options.node.sessionId,
            nodePath: options.node.nodePath,
        };

        this._tasks.set(task.id, {
            task,
            cancellationSource,
            onCancel: options.onCancel,
        });

        return task;
    }

    public get(taskId: string): ObjectExplorerTask | undefined {
        return this._tasks.get(taskId)?.task;
    }

    public async cancel(taskId: string): Promise<ObjectExplorerTask | undefined> {
        const registration = this._tasks.get(taskId);
        if (!registration) {
            return undefined;
        }

        registration.cancellationSource.cancel();
        await registration.onCancel?.(registration.task);
        return registration.task;
    }

    public complete(taskId: string): void {
        const registration = this._tasks.get(taskId);
        if (!registration) {
            return;
        }

        this._tasks.delete(taskId);
        registration.cancellationSource.dispose();
    }
}
