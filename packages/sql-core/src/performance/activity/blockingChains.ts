/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActiveRequest, IdleSession } from "./types";

export type BlockingRole = "headBlocker" | "intermediate" | "blocked";

export interface BlockingNode {
    readonly sessionId: string;
    readonly role: BlockingRole;
    /** The running request of the session. A head blocker can have no request. */
    readonly request?: ActiveRequest;
    /** Set when the session has no running request, for example a sleeping session that holds an open transaction. */
    readonly idleSession?: IdleSession;
    readonly children: readonly BlockingNode[];
}

export interface NonSessionBlocker {
    readonly sessionId: string;
    /**
     * The negative `blocking_session_id`: -2 is an orphaned distributed transaction, -3 is a
     * deferred recovery transaction, -4 and -5 are latch owners that the engine cannot identify.
     */
    readonly blockerCode: string;
}

export interface BlockingSummary {
    readonly chains: readonly BlockingNode[];
    /** Requests that wait for another owner. */
    readonly blockedCount: number;
    readonly nonSessionBlockers: readonly NonSessionBlocker[];
}

/**
 * Builds blocking chains from the blocking session of each request. A head blocker blocks other
 * sessions and is not blocked.
 */
export function buildBlockingChains(
    requests: readonly ActiveRequest[],
    idleSessions: readonly IdleSession[],
): BlockingSummary {
    const requestBySession = new Map<string, ActiveRequest>();
    for (const request of requests) {
        if (!requestBySession.has(request.sessionId)) {
            requestBySession.set(request.sessionId, request);
        }
    }
    const idleBySession = new Map(idleSessions.map((session) => [session.sessionId, session]));

    const blockerOf = new Map<string, string>();
    const childrenOf = new Map<string, string[]>();
    const nonSessionBlockers: NonSessionBlocker[] = [];

    for (const request of requestBySession.values()) {
        const blocker = request.blockingSessionId;
        if (!blocker || blocker === request.sessionId) {
            continue;
        }
        if (blocker.startsWith("-")) {
            nonSessionBlockers.push({ sessionId: request.sessionId, blockerCode: blocker });
            continue;
        }
        blockerOf.set(request.sessionId, blocker);
        const children = childrenOf.get(blocker) ?? [];
        children.push(request.sessionId);
        childrenOf.set(blocker, children);
    }

    const visited = new Set<string>();
    const buildNode = (sessionId: string, isHead: boolean): BlockingNode => {
        visited.add(sessionId);
        const childIds = (childrenOf.get(sessionId) ?? [])
            .filter((child) => !visited.has(child))
            .sort(compareSessionIds);
        const children = childIds.map((child) => buildNode(child, false));
        const role: BlockingRole = isHead
            ? "headBlocker"
            : childIds.length > 0
              ? "intermediate"
              : "blocked";
        return {
            sessionId,
            role,
            request: requestBySession.get(sessionId),
            idleSession: requestBySession.has(sessionId) ? undefined : idleBySession.get(sessionId),
            children,
        };
    };

    const heads = [...childrenOf.keys()]
        .filter((sessionId) => !blockerOf.has(sessionId))
        .sort(compareSessionIds);
    const chains = heads.map((head) => buildNode(head, true));

    // A cycle has no session without a blocker. Start each remaining cycle at its lowest session.
    const unvisitedBlockers = [...childrenOf.keys()]
        .filter((sessionId) => !visited.has(sessionId))
        .sort(compareSessionIds);
    for (const sessionId of unvisitedBlockers) {
        if (!visited.has(sessionId)) {
            chains.push(buildNode(sessionId, true));
        }
    }

    return {
        chains,
        blockedCount: blockerOf.size + nonSessionBlockers.length,
        nonSessionBlockers,
    };
}

function compareSessionIds(left: string, right: string): number {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }
    return left.localeCompare(right);
}
