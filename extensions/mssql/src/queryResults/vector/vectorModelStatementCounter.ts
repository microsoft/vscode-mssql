/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    VectorModelEgressClass,
    VectorModelStatementCounts,
} from "../../sharedInterfaces/vectorCatalog";

/** Generation-scoped controller authority for layered model-statement claims. */
export class VectorModelStatementCounter {
    private readonly counts: Record<VectorModelEgressClass, number> = {
        externalEgress: 0,
        hostLocal: 0,
        inProcess: 0,
        unknown: 0,
    };

    record(egress: VectorModelEgressClass): void {
        this.counts[egress]++;
    }

    snapshot(): VectorModelStatementCounts {
        return { ...this.counts };
    }
}
