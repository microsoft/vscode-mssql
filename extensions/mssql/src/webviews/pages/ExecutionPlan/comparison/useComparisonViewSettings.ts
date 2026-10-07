/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useState } from "react";

import {
    defaultComparisonViewSettings,
    ExecutionPlanComparisonViewSettings,
    GetComparisonViewSettingsRequest,
    UpdateComparisonViewSettingsNotification,
} from "../../../../sharedInterfaces/executionPlanComparison";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";

/**
 * The view choices the extension remembers, such as whether the minimaps show. Undefined until
 * they load, so the view does not open one way and then switch.
 */
export function useComparisonViewSettings() {
    const { extensionRpc } = useVscodeWebview();
    const [settings, setSettings] = useState<ExecutionPlanComparisonViewSettings>();

    useEffect(() => {
        void extensionRpc
            .sendRequest(GetComparisonViewSettingsRequest.type)
            .then(setSettings, () => setSettings(defaultComparisonViewSettings));
    }, [extensionRpc]);

    const updateSettings = useCallback(
        (update: Partial<ExecutionPlanComparisonViewSettings>) => {
            setSettings((current) => ({
                ...(current ?? defaultComparisonViewSettings),
                ...update,
            }));
            void extensionRpc.sendNotification(
                UpdateComparisonViewSettingsNotification.type,
                update,
            );
        },
        [extensionRpc],
    );

    return { settings, updateSettings };
}
