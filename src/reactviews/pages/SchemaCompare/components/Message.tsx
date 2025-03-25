/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { schemaCompareContext } from "../SchemaCompareStateProvider";
import { locConstants as loc } from "../../../common/locConstants";

const Message = () => {
    const context = useContext(schemaCompareContext);
    const state = context.state;

    return (
        <div>
            {!state.isComparisonInProgress &&
                state.schemaCompareResult &&
                state.schemaCompareResult.areEqual && (
                    <p>{loc.schemaCompare.noDifferences}</p>
                )}

            {state.isComparisonInProgress && (
                <p>{loc.schemaCompare.initializingComparison}</p>
            )}

            {!state.isComparisonInProgress && !state.schemaCompareResult && (
                <p>{loc.schemaCompare.intro}</p>
            )}
        </div>
    );
};

export default Message;
