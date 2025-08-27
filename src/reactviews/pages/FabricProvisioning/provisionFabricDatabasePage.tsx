/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from "react";
import { Spinner } from "@fluentui/react-components";
import { FabricProvisioningContext } from "./fabricProvisioningStateProvider";
import { locConstants } from "../../common/locConstants";

export const ProvisionFabricDatabasePage: React.FC = () => {
    const state = useContext(FabricProvisioningContext);
    const fabricProvisioningState = state?.state;

    if (!state || !fabricProvisioningState) return undefined;

    useEffect(() => {}, [fabricProvisioningState.database]);

    return (
        <div>
            {fabricProvisioningState.database && (
                <div>
                    {fabricProvisioningState.database.id}
                    {fabricProvisioningState.database.displayName}
                </div>
            )}
            {!fabricProvisioningState.database && (
                <div>
                    <Spinner
                        label={locConstants.localContainers.loadingDeploymentPage}
                        labelPosition="below"
                    />
                </div>
            )}
        </div>
    );
};
