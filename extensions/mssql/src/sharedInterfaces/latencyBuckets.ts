/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getLatencyBucket(latencyMs: number): string {
    if (latencyMs < 100) {
        return "<100";
    }

    if (latencyMs < 300) {
        return "100-300";
    }

    if (latencyMs < 800) {
        return "300-800";
    }

    if (latencyMs < 2000) {
        return "800-2000";
    }

    if (latencyMs < 5000) {
        return "2000-5000";
    }

    if (latencyMs < 10000) {
        return "5000-10000";
    }

    if (latencyMs < 15000) {
        return "10000-15000";
    }

    if (latencyMs < 20000) {
        return "15000-20000";
    }

    return "20000+";
}
