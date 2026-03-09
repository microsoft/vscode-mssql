/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

suite("DAB LM tool manifest schema", () => {
    const loadExtensionPackageJson = () => {
        // Support both out/test/unit (compiled) and test/unit (source) execution contexts.
        const candidatePaths = [
            path.resolve(__dirname, "..", "..", "..", "package.json"),
            path.resolve(__dirname, "..", "..", "package.json"),
        ];

        const readErrors: string[] = [];
        for (const candidatePath of candidatePaths) {
            if (!fs.existsSync(candidatePath)) {
                continue;
            }

            const content = fs.readFileSync(candidatePath, "utf8");
            if (!content.trim()) {
                readErrors.push(`${candidatePath}: file is empty`);
                continue;
            }

            try {
                const parsed = JSON.parse(content);
                if (parsed?.contributes?.languageModelTools) {
                    return parsed;
                }
                readErrors.push(`${candidatePath}: missing contributes.languageModelTools`);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                readErrors.push(`${candidatePath}: ${message}`);
            }
        }

        throw new Error(
            `Unable to load extension package.json. Checked ${candidatePaths.join(", ")}. ` +
                `Errors: ${readErrors.join(" | ")}`,
        );
    };

    const getTool = () => {
        const packageJson = loadExtensionPackageJson();
        const tool = (packageJson.contributes?.languageModelTools ?? []).find(
            (t: any) => t?.name === "mssql_dab",
        );
        expect(tool, "missing mssql_dab tool in contributes.languageModelTools").to.exist;
        return tool;
    };

    test("uses a visible top-level object schema instead of a root oneOf", () => {
        const tool = getTool();
        expect(tool.inputSchema?.type).to.equal("object");
        expect(tool.inputSchema?.oneOf).to.equal(undefined);
        expect(tool.inputSchema?.properties).to.include.keys(
            "operation",
            "connectionId",
            "payload",
            "options",
        );
        expect(tool.inputSchema?.required).to.deep.equal(["operation"]);
    });

    test("validates top-level operation enum and show connectionId guidance", () => {
        const tool = getTool();
        expect(tool.inputSchema?.properties?.operation?.enum).to.deep.equal([
            "get_state",
            "apply_changes",
            "show",
        ]);
        expect(tool.inputSchema?.properties?.connectionId?.minLength).to.equal(1);
        expect(tool.inputSchema?.properties?.connectionId?.description).to.contain(
            "show operation only",
        );
        expect(tool.inputSchema?.properties?.connectionId?.description).to.contain(
            "Do not include for get_state/apply_changes",
        );
    });

    test("validates apply_changes payload.expectedVersion and changes constraints", () => {
        const tool = getTool();
        const payload = tool.inputSchema?.properties?.payload;
        expect(payload?.required).to.include.members(["expectedVersion", "changes"]);
        expect(payload?.properties?.expectedVersion?.minLength).to.equal(1);
        expect(payload?.properties?.changes?.minItems).to.equal(1);
    });

    test("validates targetHint requires both server and database when provided", () => {
        const tool = getTool();
        const targetHintRequired =
            tool.inputSchema?.properties?.payload?.properties?.targetHint?.required ?? [];
        expect(targetHintRequired.slice().sort()).to.deep.equal(["database", "server"]);
    });

    test("enforces additionalProperties: false on root/payload/options/change schemas", () => {
        const tool = getTool();
        expect(tool.inputSchema?.additionalProperties).to.equal(false);
        expect(tool.inputSchema?.properties?.payload?.additionalProperties).to.equal(false);
        expect(tool.inputSchema?.properties?.options?.additionalProperties).to.equal(false);

        const changeVariants =
            tool.inputSchema?.properties?.payload?.properties?.changes?.items?.oneOf;
        expect(changeVariants, "missing changes.items.oneOf").to.be.an("array");
        for (const changeVariant of changeVariants) {
            expect(changeVariant.additionalProperties).to.equal(false);
        }
    });

    test("validates EntityRef XOR shape (id OR schemaName+tableName)", () => {
        const tool = getTool();
        const entityRef = tool.inputSchema?.$defs?.entityRef;
        expect(entityRef?.oneOf, "missing $defs.entityRef.oneOf").to.be.an("array");
        expect(entityRef.oneOf).to.have.length(2);

        const requiredLists = entityRef.oneOf.map((variant: any) =>
            (variant.required ?? []).slice().sort(),
        );
        expect(requiredLists).to.deep.include.members([["id"], ["schemaName", "tableName"]]);
    });

    test("validates enums for apiTypes/enabledActions/authorizationRole/returnState", () => {
        const tool = getTool();
        const changeVariants =
            tool.inputSchema?.properties?.payload?.properties?.changes?.items?.oneOf;
        const byType = new Map<string, any>();
        for (const variant of changeVariants) {
            byType.set(variant?.properties?.type?.enum?.[0], variant);
        }

        expect(byType.get("set_api_types")?.properties?.apiTypes?.items?.enum).to.deep.equal([
            "rest",
            "graphql",
            "mcp",
        ]);
        expect(
            byType.get("set_entity_actions")?.properties?.enabledActions?.items?.enum,
        ).to.deep.equal(["create", "read", "update", "delete"]);
        expect(
            tool.inputSchema?.$defs?.advancedSettingsPatch?.properties?.authorizationRole?.enum,
        ).to.deep.equal(["anonymous", "authenticated"]);
        expect(tool.inputSchema?.properties?.options?.properties?.returnState?.enum).to.deep.equal([
            "full",
            "summary",
            "none",
        ]);
    });

    test("validates nullable clear semantics for customRestPath/customGraphQLType", () => {
        const tool = getTool();
        const patchSchema = tool.inputSchema?.$defs?.advancedSettingsPatch;
        const customRestPathOneOf = patchSchema?.properties?.customRestPath?.oneOf;
        const customGraphQLTypeOneOf = patchSchema?.properties?.customGraphQLType?.oneOf;

        expect(customRestPathOneOf, "missing customRestPath.oneOf").to.be.an("array");
        expect(customGraphQLTypeOneOf, "missing customGraphQLType.oneOf").to.be.an("array");

        const hasStringMinLengthAndNull = (variants: any[]) => {
            const hasString = variants.some(
                (variant) => variant?.type === "string" && variant?.minLength === 1,
            );
            const hasNull = variants.some((variant) => variant?.type === "null");
            return hasString && hasNull;
        };

        expect(hasStringMinLengthAndNull(customRestPathOneOf)).to.equal(true);
        expect(hasStringMinLengthAndNull(customGraphQLTypeOneOf)).to.equal(true);
    });

    test("mssql_dab is always available", () => {
        const tool = getTool();
        expect(tool.when).to.be.undefined;
    });
});
