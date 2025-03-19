/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as xml2js from "xml2js";

export async function mergeCoverage(
    e2eFile: string,
    unitFile: string,
    outFile: string,
): Promise<void> {
    const parser = new xml2js.Parser();
    const builder = new xml2js.Builder();

    try {
        // Read and parse the e2e XML file
        const e2eXml = fs.readFileSync(e2eFile, "utf-8");
        const e2eData = await parser.parseStringPromise(e2eXml);
        const e2eRoot = e2eData.coverage;

        // Read and parse the unit XML file
        const unitXml = fs.readFileSync(unitFile, "utf-8");
        const unitData = await parser.parseStringPromise(unitXml);
        const unitRoot = unitData.coverage;

        if (!unitRoot || !e2eRoot) {
            throw new Error("Invalid XML structure: Missing coverage data.");
        }

        // Merge the coverage data from both <coverage> elements
        const linesValid = calculateMergedValue(
            unitRoot,
            e2eRoot,
            "lines-valid",
        );
        const linesCovered = calculateMergedValue(
            unitRoot,
            e2eRoot,
            "lines-covered",
        );
        const branchesValid = calculateMergedValue(
            unitRoot,
            e2eRoot,
            "branches-valid",
        );
        const branchesCovered = calculateMergedValue(
            unitRoot,
            e2eRoot,
            "branches-covered",
        );

        // Calculate the line-rate and branch-rate as a weighted average
        const lineRate = calculateWeightedRate(
            unitRoot,
            e2eRoot,
            "line-rate",
            linesValid,
        );
        const branchRate = calculateWeightedRate(
            unitRoot,
            e2eRoot,
            "branch-rate",
            branchesValid,
        );

        // Set the merged values back to the main coverage element
        setMergedValues(
            unitRoot,
            linesValid,
            linesCovered,
            lineRate,
            branchesValid,
            branchesCovered,
            branchRate,
        );

        // Find the <packages> parent element in the main XML
        const packages = unitRoot.packages[0]["package"];
        const reactPackageElement = e2eRoot.packages[0].package[0];
        if (packages && reactPackageElement) {
            reactPackageElement["$"]["name"] = "src.reactviews.pages"; // Update the name attribute
            packages.push(reactPackageElement); // Append the updated package element
        }

        // Convert the merged data back to XML and write to a file
        const mergedXml = builder.buildObject(unitData);
        fs.writeFileSync(outFile, mergedXml, "utf-8");

        console.log("Coverage merged successfully!");
    } catch (error) {
        console.error("Error during coverage merge:", error);
    }
}

// Helper function to calculate the merged value of a specific property
function calculateMergedValue(
    unitRoot: any,
    e2eRoot: any,
    key: string,
): number {
    return parseInt(unitRoot["$"][key], 10) + parseInt(e2eRoot["$"][key], 10);
}

// Helper function to calculate the weighted rate (line-rate or branch-rate)
function calculateWeightedRate(
    unitRoot: any,
    e2eRoot: any,
    rateKey: string,
    validLines: number,
): number {
    return (
        (parseFloat(unitRoot["$"][rateKey]) *
            parseInt(unitRoot["$"]["lines-valid"], 10) +
            parseFloat(e2eRoot["$"][rateKey]) *
                parseInt(e2eRoot["$"]["lines-valid"], 10)) /
        validLines
    );
}

// Helper function to set the merged values back to the unit coverage object
function setMergedValues(
    unitRoot: any,
    linesValid: number,
    linesCovered: number,
    lineRate: number,
    branchesValid: number,
    branchesCovered: number,
    branchRate: number,
): void {
    unitRoot["$"]["lines-valid"] = linesValid.toString();
    unitRoot["$"]["lines-covered"] = linesCovered.toString();
    unitRoot["$"]["line-rate"] = lineRate.toString();
    unitRoot["$"]["branches-valid"] = branchesValid.toString();
    unitRoot["$"]["branches-covered"] = branchesCovered.toString();
    unitRoot["$"]["branch-rate"] = branchRate.toString();
}
