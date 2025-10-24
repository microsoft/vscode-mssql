/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { DataTierApplicationContext } from "./dataTierApplicationStateProvider";
import { DataTierApplicationForm } from "./dataTierApplicationForm";

export const DataTierApplicationPage = () => {
    const context = useContext(DataTierApplicationContext);

    if (!context) {
        return <div>Loading...</div>;
    }

    return <DataTierApplicationForm />;
};
