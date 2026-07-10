/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Connection-group management from OE v2 (OE_V1_PARITY_PLAN §2.6, K5):
 * create/edit reuse the CLASSIC ConnectionGroupWebviewController dialog over
 * the SAME ConnectionConfig storage (mssql.connectionGroups) — no new
 * grouping model, no classic file touched. Delete mirrors the classic
 * Delete-contents/Move-contents modal. Move-to-group is a quick pick over
 * the group tree. The v2 tree re-renders through the existing settings
 * watcher; classic re-renders the same way — one storage, two views.
 */

import * as vscode from "vscode";
import { ConnectionConfig } from "../../../connectionconfig/connectionconfig";
import { ConnectionGroupWebviewController } from "../../../controllers/connectionGroupWebviewController";
import * as LocalizedConstants from "../../../constants/locConstants";
import { IConnectionGroup, IConnectionProfile } from "../../../models/interfaces";
import { diag } from "../../../diagnostics/diagnosticsCore";
import { stableProfileId } from "../../../services/metadata/profileAuthAdapter";
import { OeV2Node } from "../tree/oeV2Node";

export interface OeV2GroupCommandDeps {
    readonly context: vscode.ExtensionContext;
    /** The shared classic config — undefined when not injected (tests). */
    readonly groupConfig: () => ConnectionConfig | undefined;
}

function emitGroupMutation(op: string, result: "ok" | "canceled" | "failed"): void {
    diag.emit({
        feature: "objectExplorer",
        kind: "event",
        type: "objectExplorerV2.group.mutate",
        fields: {
            op: { raw: op, cls: "diagnostic.metadata" },
            result: { raw: result, cls: "diagnostic.metadata" },
        },
    });
}

function groupIdOf(node: OeV2Node | undefined): string | undefined {
    return node?.path.kind === "connectionGroup" ? node.path.groupId : undefined;
}

async function findGroup(
    config: ConnectionConfig,
    groupId: string,
): Promise<IConnectionGroup | undefined> {
    return (await config.getGroups()).find((group) => group.id === groupId);
}

/** Descendant walk for the drag-drop cycle guard (self/descendant refusal). */
export function wouldCreateCycle(
    groups: readonly { id: string; parentId?: string }[],
    draggedGroupId: string,
    targetGroupId: string,
): boolean {
    if (draggedGroupId === targetGroupId) {
        return true;
    }
    let cursor: string | undefined = targetGroupId;
    const seen = new Set<string>();
    while (cursor !== undefined && !seen.has(cursor)) {
        if (cursor === draggedGroupId) {
            return true;
        }
        seen.add(cursor);
        cursor = groups.find((group) => group.id === cursor)?.parentId;
    }
    return false;
}

export function registerOeV2GroupCommands(deps: OeV2GroupCommandDeps): vscode.Disposable {
    const { context, groupConfig } = deps;

    const create = vscode.commands.registerCommand(
        "mssql.objectExplorerV2.connectionGroups.create",
        (node?: OeV2Node) => {
            const config = groupConfig();
            if (!config) {
                return;
            }
            // Creating from a group node's context menu nests under it.
            const parentId = groupIdOf(node);
            const dialog = new ConnectionGroupWebviewController(context, config);
            dialog.revealToForeground();
            emitGroupMutation("create", "ok");
            void parentId; // dialog assigns root parent; nesting via move/DnD
        },
    );

    const edit = vscode.commands.registerCommand(
        "mssql.objectExplorerV2.connectionGroups.edit",
        async (node?: OeV2Node) => {
            const config = groupConfig();
            const groupId = groupIdOf(node);
            if (!config || !groupId) {
                return;
            }
            const group = await findGroup(config, groupId);
            if (!group) {
                void vscode.window.showWarningMessage(
                    "That connection group no longer exists. Refresh the view.",
                );
                return;
            }
            new ConnectionGroupWebviewController(context, config, group).revealToForeground();
            emitGroupMutation("edit", "ok");
        },
    );

    const remove = vscode.commands.registerCommand(
        "mssql.objectExplorerV2.connectionGroups.delete",
        async (node?: OeV2Node) => {
            const config = groupConfig();
            const groupId = groupIdOf(node);
            if (!config || !groupId || !node) {
                return;
            }
            const [groups, connections] = await Promise.all([
                config.getGroups(),
                config.getConnections(),
            ]);
            const hasContents =
                groups.some((group) => group.parentId === groupId) ||
                connections.some((profile) => profile.groupId === groupId);
            // Classic modal parity: contents offer Delete vs Move; empty
            // groups offer plain Delete.
            let mode: "delete" | "move" | undefined;
            if (hasContents) {
                const choice = await vscode.window.showInformationMessage(
                    LocalizedConstants.ObjectExplorer.ConnectionGroupDeletionConfirmationWithContents(
                        node.label,
                    ),
                    { modal: true },
                    LocalizedConstants.ObjectExplorer.ConnectionGroupDeleteContents,
                    LocalizedConstants.ObjectExplorer.ConnectionGroupMoveContents,
                );
                mode =
                    choice === LocalizedConstants.ObjectExplorer.ConnectionGroupDeleteContents
                        ? "delete"
                        : choice === LocalizedConstants.ObjectExplorer.ConnectionGroupMoveContents
                          ? "move"
                          : undefined;
            } else {
                const choice = await vscode.window.showInformationMessage(
                    LocalizedConstants.ObjectExplorer.ConnectionGroupDeletionConfirmationWithoutContents(
                        node.label,
                    ),
                    { modal: true },
                    LocalizedConstants.Common.delete,
                );
                mode = choice === LocalizedConstants.Common.delete ? "delete" : undefined;
            }
            if (!mode) {
                emitGroupMutation("delete", "canceled");
                return;
            }
            await config.removeGroup(groupId, mode);
            emitGroupMutation("delete", "ok");
        },
    );

    const moveToGroup = vscode.commands.registerCommand(
        "mssql.objectExplorerV2.moveToGroup",
        async (node?: OeV2Node) => {
            const config = groupConfig();
            const connectionId =
                node?.connectionId ??
                (node?.path.kind === "connection" ? node.path.connectionId : undefined);
            if (!config || !connectionId) {
                return;
            }
            const [groups, connections] = await Promise.all([
                config.getGroups(),
                config.getConnections(),
            ]);
            const profile = connections.find(
                (candidate) => stableProfileId(candidate as { id?: string }) === connectionId,
            );
            if (!profile) {
                void vscode.window.showWarningMessage(
                    "That connection could not be found in saved connections.",
                );
                return;
            }
            const rootId = groups.find(
                (group) => group.id === "ROOT" || group.parentId === undefined,
            )?.id;
            const picked = await vscode.window.showQuickPick(
                groups
                    .filter((group) => group.id !== profile.groupId)
                    .map((group) => ({
                        label: group.id === rootId ? "(Root)" : group.name,
                        groupId: group.id,
                    })),
                { title: "Move connection to group" },
            );
            if (!picked) {
                emitGroupMutation("moveConnection", "canceled");
                return;
            }
            await config.updateConnection({
                ...profile,
                groupId: picked.groupId,
            } as IConnectionProfile);
            emitGroupMutation("moveConnection", "ok");
        },
    );

    return vscode.Disposable.from(create, edit, remove, moveToGroup);
}

/**
 * Drag-and-drop over the v2 tree (K5): connections move into groups, groups
 * re-parent (cycle-guarded) — same shared-storage semantics as the classic
 * controller, own MIME type so the two views never cross-drop.
 */
export class OeV2DragAndDropController implements vscode.TreeDragAndDropController<OeV2Node> {
    static readonly MIME = "application/vnd.code.tree.mssql.objectexplorerv2";
    readonly dragMimeTypes = [OeV2DragAndDropController.MIME];
    readonly dropMimeTypes = [OeV2DragAndDropController.MIME];

    constructor(private readonly groupConfig: () => ConnectionConfig | undefined) {}

    handleDrag(source: readonly OeV2Node[], dataTransfer: vscode.DataTransfer): void {
        const node = source.find(
            (candidate) =>
                candidate.path.kind === "connectionGroup" || candidate.path.kind === "connection",
        );
        if (!node) {
            return;
        }
        const payload =
            node.path.kind === "connectionGroup"
                ? { type: "connectionGroup", id: node.path.groupId }
                : {
                      type: "connection",
                      id: (node.path as { connectionId: string }).connectionId,
                  };
        dataTransfer.set(
            OeV2DragAndDropController.MIME,
            new vscode.DataTransferItem(JSON.stringify(payload)),
        );
    }

    async handleDrop(
        target: OeV2Node | undefined,
        dataTransfer: vscode.DataTransfer,
    ): Promise<void> {
        const config = this.groupConfig();
        const raw = dataTransfer.get(OeV2DragAndDropController.MIME);
        if (!config || !raw) {
            return;
        }
        let payload: { type: string; id: string };
        try {
            payload = JSON.parse(await raw.asString()) as { type: string; id: string };
        } catch {
            return;
        }
        const groups = await config.getGroups();
        const rootId = groups.find(
            (group) => group.id === "ROOT" || group.parentId === undefined,
        )?.id;
        const targetGroupId =
            target === undefined
                ? rootId
                : target.path.kind === "connectionGroup"
                  ? target.path.groupId
                  : undefined;
        if (!targetGroupId) {
            return; // only groups (or the root surface) are drop targets
        }
        if (payload.type === "connection") {
            const connections = await config.getConnections();
            const profile = connections.find(
                (candidate) => stableProfileId(candidate as { id?: string }) === payload.id,
            );
            if (profile && profile.groupId !== targetGroupId) {
                await config.updateConnection({
                    ...profile,
                    groupId: targetGroupId,
                } as IConnectionProfile);
                emitGroupMutation("dnd", "ok");
            }
            return;
        }
        if (payload.type === "connectionGroup") {
            if (wouldCreateCycle(groups, payload.id, targetGroupId)) {
                emitGroupMutation("dnd", "canceled");
                return;
            }
            const group = groups.find((candidate) => candidate.id === payload.id);
            if (group && group.parentId !== targetGroupId) {
                await config.updateGroup({ ...group, parentId: targetGroupId });
                emitGroupMutation("dnd", "ok");
            }
        }
    }
}
