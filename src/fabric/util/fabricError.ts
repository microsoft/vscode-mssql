/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityStatus, TelemetryActions, TelemetryViews } from "../../sharedInterfaces/telemetry";
import { startActivity } from "../../telemetry/telemetry";

export async function doFabricAction<R>(
    //options: FabricActionOptions,
    action: () => Promise<R>,
): Promise<R> {
    // if (options.telemetryActivity) {
    //     return await options.telemetryActivity.doTelemetryActivity(async () => {
    //         return await doFabricActionInternal(options, action);
    //     });
    // }
    // else {
    //     return await doFabricActionInternal(options, action);
    // }

    const activity = startActivity(TelemetryViews.FabricAction, TelemetryActions.DoFabricAction);
    let result: R;
    try {
        result = await action();
    } catch (error) {
        activity.endFailed(error);
        throw error;
    }
    activity.end(ActivityStatus.Succeeded);

    return result;
}
