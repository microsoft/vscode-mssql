/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { Spinner } from "@fluentui/react-components";
import { DataTierApplicationContext } from "./dataTierApplicationStateProvider";
import { DataTierApplicationForm } from "./dataTierApplicationForm";
import { locConstants } from "../../common/locConstants";

export const DataTierApplicationPage = () => {
    const context = useContext(DataTierApplicationContext);

    if (!context) {
        return <Spinner label={locConstants.dataTierApplication.loading} labelPosition="below" />;
    }

    return <DataTierApplicationForm />;
};
