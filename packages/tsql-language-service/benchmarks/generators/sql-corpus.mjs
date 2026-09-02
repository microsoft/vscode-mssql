/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function generateSqlCorpus(targetLength) {
    const statements = [
        "SELECT u.Id, u.Name FROM dbo.Users AS u WHERE u.Id > 0;\nGO\n",
        "INSERT INTO sales.Orders (UserId, Total) VALUES (1, 42.00);\nGO\n",
        "CREATE TABLE #Work (Id int NOT NULL, Payload nvarchar(max) NULL);\nGO\n",
        "WITH cte AS (SELECT Id FROM dbo.Users) SELECT Id FROM cte ORDER BY Id;\nGO\n",
    ];
    if (!Number.isSafeInteger(targetLength) || targetLength < statements[0].length) {
        throw new RangeError("targetLength must fit at least one complete benchmark statement");
    }
    let text = "";
    for (let index = 0; ; index++) {
        const statement = statements[index % statements.length];
        if (text.length + statement.length > targetLength) break;
        text += statement;
    }
    // ASCII whitespace makes the UTF-8 byte count exact without introducing an incomplete statement.
    return text.padEnd(targetLength, " ");
}
