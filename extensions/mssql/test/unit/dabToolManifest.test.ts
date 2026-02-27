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

    test("validates root operation oneOf (get_state vs apply_changes)", () => {
        const tool = getTool();
        const rootOneOf = tool.inputSchema?.oneOf ?? undefined;
        expect(rootOneOf, "missing inputSchema.oneOf").to.be.an("array");

        const operations = rootOneOf
            .map((variant: any) => variant?.properties?.operation?.enum?.[0])
            .filter(Boolean);
        expect(operations.sort()).to.deep.equal(["apply_changes", "get_state"].sort());
    });

    test("validates apply_changes payload.expectedVersion and changes constraints", () => {
        const tool = getTool();
        const rootOneOf = tool.inputSchema?.oneOf ?? undefined;
        const applyChanges = rootOneOf.find(
            (variant: any) => variant?.properties?.operation?.enum?.[0] === "apply_changes",
        );
        expect(applyChanges, "missing apply_changes oneOf variant").to.exist;

        const payload = applyChanges.properties?.payload;
        expect(payload.required).to.include.members(["expectedVersion", "changes"]);
        expect(payload.properties?.expectedVersion?.minLength).to.equal(1);
        expect(payload.properties?.changes?.minItems).to.equal(1);
    });

    test("validates targetHint requires both server and database when provided", () => {
        const tool = getTool();
        const rootOneOf = tool.inputSchema?.oneOf ?? undefined;
        const applyChanges = rootOneOf.find(
            (variant: any) => variant?.properties?.operation?.enum?.[0] === "apply_changes",
        );
        expect(applyChanges, "missing apply_changes oneOf variant").to.exist;

        const targetHintRequired =
            applyChanges.properties?.payload?.properties?.targetHint?.required ?? [];
        expect(targetHintRequired.slice().sort()).to.deep.equal(["database", "server"]);
    });

    test("enforces additionalProperties: false on root/payload/options/change schemas", () => {
        const tool = getTool();
        const rootOneOf = tool.inputSchema?.oneOf ?? undefined;
        const getState = rootOneOf.find(
            (variant: any) => variant?.properties?.operation?.enum?.[0] === "get_state",
        );
        const applyChanges = rootOneOf.find(
            (variant: any) => variant?.properties?.operation?.enum?.[0] === "apply_changes",
        );
        expect(getState.additionalProperties).to.equal(false);
        expect(applyChanges.additionalProperties).to.equal(false);
        expect(applyChanges.properties?.payload?.additionalProperties).to.equal(false);
        expect(applyChanges.properties?.options?.additionalProperties).to.equal(false);

        const changeVariants = applyChanges.properties?.payload?.properties?.changes?.items?.oneOf;
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

    test("validates enums for apiTypes/actions/authorizationRole/returnState", () => {
        const tool = getTool();
        const rootOneOf = tool.inputSchema?.oneOf ?? undefined;
        const applyChanges = rootOneOf.find(
            (variant: any) => variant?.properties?.operation?.enum?.[0] === "apply_changes",
        );
        const changeVariants = applyChanges.properties?.payload?.properties?.changes?.items?.oneOf;
        const byType = new Map<string, any>();
        for (const variant of changeVariants) {
            byType.set(variant?.properties?.type?.enum?.[0], variant);
        }

        expect(byType.get("set_api_types")?.properties?.apiTypes?.items?.enum).to.deep.equal([
            "rest",
            "graphql",
            "mcp",
        ]);
        expect(byType.get("set_entity_actions")?.properties?.actions?.items?.enum).to.deep.equal([
            "create",
            "read",
            "update",
            "delete",
        ]);
        expect(
            tool.inputSchema?.$defs?.advancedSettingsPatch?.properties?.authorizationRole?.enum,
        ).to.deep.equal(["anonymous", "authenticated"]);
        expect(applyChanges.properties?.options?.properties?.returnState?.enum).to.deep.equal([
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

    test("mssql_dab is gated behind the DAB feature flag", () => {
        const tool = getTool();
        expect(tool.when).to.equal("config.mssql.enableDAB");
    });
});
