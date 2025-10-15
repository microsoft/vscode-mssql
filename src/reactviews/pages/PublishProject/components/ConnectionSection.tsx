/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState, useEffect } from "react";
import { PublishProjectContext } from "../publishProjectStateProvider";
import { usePublishDialogSelector } from "../publishDialogSelector";
import { renderInput } from "./FormFieldComponents";

export const ConnectionSection: React.FC = () => {
    const publishCtx = useContext(PublishProjectContext);
    const serverComponent = usePublishDialogSelector((s) => s.formComponents.serverName);
    const databaseComponent = usePublishDialogSelector((s) => s.formComponents.databaseName);
    const serverValue = usePublishDialogSelector((s) => s.formState.serverName);
    const databaseValue = usePublishDialogSelector((s) => s.formState.databaseName);

    const [localServer, setLocalServer] = useState(serverValue || "");
    const [localDatabase, setLocalDatabase] = useState(databaseValue || "");

    useEffect(() => setLocalServer(serverValue || ""), [serverValue]);
    useEffect(() => setLocalDatabase(databaseValue || ""), [databaseValue]);

    if (!publishCtx) {
        return undefined;
    }

    return (
        <>
            {renderInput(serverComponent, localServer, setLocalServer, publishCtx)}
            {renderInput(databaseComponent, localDatabase, setLocalDatabase, publishCtx)}
        </>
    );
};
