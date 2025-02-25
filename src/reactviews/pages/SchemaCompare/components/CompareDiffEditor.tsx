/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DiffEditor } from "@monaco-editor/react";
import "./compareDiffEditor.css";

const CompareDiffEditor = () => {
    const original =
        "CREATE TABLE [dbo].[Address] (\r\n [AddressID] INT NOT NULL PRIMARY KEY CLUSTERED ([AddressID] ASC),\r\n [PersonID] INT NULL,\r\n [Street] VARCHAR (255) NULL,\r\n [Street2] VARCHAR (255) NULL,\r\n [City] VARCHAR (255) NULL,\r\n [State] VARCHAR (255) NULL,\r\n [ZipCode] VARCHAR (10) NULL,\r\n [Country] VARCHAR (20) NULL\r\n);\r\nGO";
    const modified =
        "CREATE TABLE [dbo].[Address] (\r\n [AddressID] INT NOT NULL PRIMARY KEY CLUSTERED ([AddressID] ASC),\r\n [PersonID] INT NULL,\r\n [Street] VARCHAR (255) NULL,\r\n [City] VARCHAR (255) NULL,\r\n [State] VARCHAR (255) NULL,\r\n [ZipCode] VARCHAR (10) NULL,\r\n FOREIGN KEY ([PersonID]) REFERENCES [dbo].[Person] ([PersonID])\r\n);\r\nGO";

    const handleEditorDidMount = (editor: any, _: any) => {
        const originalModel = editor.getOriginalEditor().getModel();
        const modifiedModel = editor.getModifiedEditor().getModel();

        const invertDiffs = () => {
            const originalValue = originalModel.getValue();
            const modifiedValue = modifiedModel.getValue();

            // Swap the values
            originalModel.setValue(modifiedValue);
            modifiedModel.setValue(originalValue);
        };

        // Call the function to invert the diffs
        invertDiffs();
    };

    return (
        <div style={{ height: "60vh" }}>
            <DiffEditor
                height="60vh"
                language="sql"
                original={original}
                modified={modified}
                onMount={handleEditorDidMount}
                options={{
                    renderSideBySide: true,
                    renderOverviewRuler: true,
                    OverviewRulerLane: 0,
                }}
            />
        </div>
    );
};

export default CompareDiffEditor;
