/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Bounded semantic projection of the DacFx deployment-report XML contract. */

const MAX_RENDERED_CHANGES = 20;
const MAX_RENDERED_ALERTS = 10;
const MAX_RENDERED_OPERATION_GROUPS = 12;
const MAX_LABEL_LENGTH = 500;

export interface SchemaDiffOperationGroup {
    name: string;
    count: number;
}

export interface SchemaDiffItem {
    operation: string;
    objectType?: string;
    name: string;
}

export interface SchemaDiffAlert {
    kind: string;
    detail?: string;
}

export interface SchemaDiffProjection {
    changeCount: number;
    operationGroups: SchemaDiffOperationGroup[];
    omittedOperationGroupCount: number;
    changes: SchemaDiffItem[];
    omittedChangeCount: number;
    alertCount: number;
    alerts: SchemaDiffAlert[];
    omittedAlertCount: number;
}

interface XmlElementCollection {
    length: number;
    item(index: number): XmlElementLike | null;
}

interface XmlElementLike {
    localName: string | null;
    nodeName: string;
    textContent: string | null;
    getAttribute(name: string): string | null;
    getElementsByTagName(name: string): XmlElementCollection;
}

interface XmlDocumentLike {
    documentElement: XmlElementLike | null;
    getElementsByTagName(name: string): XmlElementCollection;
}

export function projectDacpacSchemaDiff(
    document: XmlDocumentLike,
): SchemaDiffProjection | undefined {
    const root = document.documentElement;
    if (!root || localNameOf(root) !== "DeploymentReport") {
        return undefined;
    }

    const operationCounts = new Map<string, number>();
    const changes: SchemaDiffItem[] = [];
    let changeCount = 0;
    for (const operation of elementsNamed(document, "Operation")) {
        const operationName = boundedLabel(operation.getAttribute("Name")) || "Other";
        const items = descendantElementsNamed(operation, "Item");
        if (items.length === 0) {
            continue;
        }
        operationCounts.set(
            operationName,
            (operationCounts.get(operationName) ?? 0) + items.length,
        );
        changeCount += items.length;
        for (const item of items) {
            if (changes.length >= MAX_RENDERED_CHANGES) {
                break;
            }
            changes.push({
                operation: operationName,
                ...(boundedLabel(item.getAttribute("Type"))
                    ? { objectType: boundedLabel(item.getAttribute("Type")) }
                    : {}),
                name:
                    boundedLabel(item.getAttribute("Value")) ||
                    boundedLabel(item.textContent) ||
                    "",
            });
        }
    }

    const alertElements = elementsNamed(document, "Alert");
    const alerts: SchemaDiffAlert[] = [];
    for (const alert of alertElements.slice(0, MAX_RENDERED_ALERTS)) {
        const issue = descendantElementsNamed(alert, "Issue")[0];
        const detail =
            boundedLabel(issue?.getAttribute("Value")) ||
            boundedLabel(alert.getAttribute("Value")) ||
            boundedLabel(issue?.textContent);
        alerts.push({
            kind: boundedLabel(alert.getAttribute("Name")) || "Alert",
            ...(detail ? { detail } : {}),
        });
    }

    const allOperationGroups = [...operationCounts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
    const operationGroups = allOperationGroups.slice(0, MAX_RENDERED_OPERATION_GROUPS);

    return {
        changeCount,
        operationGroups,
        omittedOperationGroupCount: allOperationGroups.length - operationGroups.length,
        changes,
        omittedChangeCount: Math.max(0, changeCount - changes.length),
        alertCount: alertElements.length,
        alerts,
        omittedAlertCount: Math.max(0, alertElements.length - alerts.length),
    };
}

function elementsNamed(root: XmlDocumentLike | XmlElementLike, name: string): XmlElementLike[] {
    const elements = root.getElementsByTagName("*");
    const matches: XmlElementLike[] = [];
    for (let index = 0; index < elements.length; index++) {
        const element = elements.item(index);
        if (element && localNameOf(element) === name) {
            matches.push(element);
        }
    }
    return matches;
}

function descendantElementsNamed(root: XmlElementLike, name: string): XmlElementLike[] {
    return elementsNamed(root, name);
}

function localNameOf(element: XmlElementLike): string {
    return element.localName || element.nodeName.split(":").at(-1) || "";
}

function boundedLabel(value: string | null | undefined): string {
    return (value ?? "").trim().slice(0, MAX_LABEL_LENGTH);
}
