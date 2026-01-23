/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum CommandPhase {
    Drop,
    Alter,
    Create,
}

export interface DesignerCommand {
    id: string;
    phase: CommandPhase;
    statements: string[];
    description?: string;
    dependencies: Set<string>;
}

export class CommandGraph {
    private readonly _commands = new Map<string, DesignerCommand>();

    addCommand(command: DesignerCommand): void {
        this._commands.set(command.id, command);
    }

    public toStatements(): string[] {
        const result: string[] = [];
        for (const phase of [CommandPhase.Drop, CommandPhase.Alter, CommandPhase.Create]) {
            for (const command of this.getOrderedCommands(phase)) {
                result.push(...command.statements);
            }
        }
        return result;
    }

    public getOrderedCommands(phase: CommandPhase): DesignerCommand[] {
        return this.topologicalSort(phase);
    }

    private topologicalSort(phase: CommandPhase): DesignerCommand[] {
        const filtered = Array.from(this._commands.values()).filter((command) => command.phase === phase);
        const visited = new Set<string>();
        const visiting = new Set<string>();
        const ordered: DesignerCommand[] = [];

        const visit = (command: DesignerCommand) => {
            if (visited.has(command.id)) {
                return;
            }
            if (visiting.has(command.id)) {
                return;
            }
            visiting.add(command.id);
            for (const dependencyId of command.dependencies) {
                const dependency = this._commands.get(dependencyId);
                if (dependency && dependency.phase === phase) {
                    visit(dependency);
                }
            }
            visiting.delete(command.id);
            visited.add(command.id);
            ordered.push(command);
        };

        filtered.forEach(visit);
        return ordered;
    }
}
