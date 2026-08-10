import { analyze } from "../../src/parser/saral/analyze.js";

describe("T-SQL Parser - Test", () => {
    test("Sample SQL", () => {
        const result = analyze(`-- Valid SQL with no issues

SELECT Id, Name, Salary
FROM Employees
WHERE Salary > 50000
ORDER BY HireDate DESC;`);

        console.log(JSON.stringify(result.issues, null, 2));

        expect(result.issues.length).toBe(0);

        console.log(JSON.stringify(result.diagnostics, null, 2));

        expect(result.diagnostics.length).toBe(0);
    });
});
