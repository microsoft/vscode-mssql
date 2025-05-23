/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { MetadataService, TableInfo, ColumnInfo } from '../metadata/metadataService';
import ConnectionManager from '../controllers/connectionManager';

export class SqlCompletionItemProvider implements vscode.CompletionItemProvider {
    private metadataService: MetadataService;

    constructor(connectionManager: ConnectionManager) {
        this.metadataService = new MetadataService(connectionManager);
    }

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): Promise<vscode.CompletionItem[] | vscode.CompletionList> {
        console.log('🎯 Enhanced IntelliSense: completion triggered!');
        const uri = document.uri.toString(true);
        const lineText = document.lineAt(position).text;
        const currentWord = this.getCurrentWord(lineText, position.character);

        console.log(`📍 Current line: "${lineText}"`);
        console.log(`📍 Position: line ${position.line}, char ${position.character}`);
        console.log(`📍 Current word: "${currentWord}"`);

        try {
            // Get full document text for alias parsing
            const sqlText = document.getText();
            const cursorOffset = document.offsetAt(position);

            console.log(`📄 Full SQL text length: ${sqlText.length}`);
            console.log(`📍 Cursor offset: ${cursorOffset}`);
            console.log(`📄 Text around cursor: "${sqlText.substring(Math.max(0, cursorOffset-50), cursorOffset + 10)}"`);

            // Check if this is an alias-based column completion (e.g., "b." where b is an alias)
            const aliasMapping = this.metadataService.parseAliasFromQuery(sqlText, cursorOffset);

            if (aliasMapping) {
                console.log(`🎯 Alias-based completion detected: ${aliasMapping.alias} -> ${aliasMapping.fullyQualifiedName}`);
                return await this.provideColumnCompletions(uri, aliasMapping, currentWord);
            } else {
                console.log(`❌ No alias detected - falling back to table completion`);
            }

            // If no alias detected, fall back to table completion
            const tables = await this.metadataService.searchTables(uri, currentWord);

            console.log(`📋 Found ${tables.length} matching tables`);

            // VS Code completion items'a dönüştür
            const completionItems = tables.map(table => this.tableToCompletionItem(table));

            // ✅ Table completion için de exclusive list
            return new vscode.CompletionList(completionItems, false);
        } catch (error) {
            console.error('❌ Error fetching completion items:', error);
            return [];
        }
    }

    private getCurrentWord(line: string, position: number): string {
        const beforeCursor = line.substring(0, position);

        // If we're after a dot, get the part after the dot
        const dotMatch = beforeCursor.match(/\.(\w*)$/);
        if (dotMatch) {
            console.log(`📍 After dot completion: "${dotMatch[1]}"`);
            return dotMatch[1];
        }

        // Otherwise get the current word being typed
        const match = beforeCursor.match(/\b(\w+)$/);
        const word = match ? match[1] : '';
        console.log(`📍 Word-based completion: "${word}"`);
        return word;
    }

    private tableToCompletionItem(table: TableInfo): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            table.fullyQualifiedName,
            vscode.CompletionItemKind.Property
        );

        item.label = table.name;
        item.insertText = table.fullyQualifiedName;
        item.detail = `${table.type} • ${table.schema}`;
        item.documentation = new vscode.MarkdownString(
            `**${table.type}**: \`${table.fullyQualifiedName}\`\n\n` +
            `Schema: ${table.schema}`
        );
        item.sortText = `${table.type === 'Table' ? '500' : '501'}_${table.name}`;
        item.filterText = `${table.name} ${table.schema} ${table.fullyQualifiedName}`;

        return item;
    }

    private async provideColumnCompletions(
        uri: string,
        aliasMapping: { alias: string; tableName: string; schema: string; fullyQualifiedName: string },
        searchTerm: string
    ): Promise<vscode.CompletionList> {
        console.log(`🔍 Getting columns for ${aliasMapping.fullyQualifiedName} with search term: "${searchTerm}"`);

        const columns = await this.metadataService.getColumnsForTable(
            uri,
            aliasMapping.tableName,
            aliasMapping.schema
        );

        // Filter columns by search term
        const filteredColumns = searchTerm
            ? columns.filter(col => col.name.toLowerCase().includes(searchTerm.toLowerCase()))
            : columns;

        console.log(`📋 Found ${filteredColumns.length} matching columns`);

        const completionItems = filteredColumns.map(column => this.columnToCompletionItem(column, aliasMapping.alias));

        // ✅ ÖNEMLİ: Alias completion için exclusive completion list dön
        // Bu, diğer completion provider'ların çalışmasını engeller
        return new vscode.CompletionList(completionItems, true); // true = isIncomplete=false yani exclusive
    }

    private columnToCompletionItem(column: ColumnInfo, alias: string): vscode.CompletionItem {
        const item = new vscode.CompletionItem(
            column.name,
            vscode.CompletionItemKind.Field
        );

        item.label = column.name;
        item.insertText = column.name;
        item.detail = `${column.dataType} • ${column.schema}`;
        item.documentation = new vscode.MarkdownString(
            `**Column**: \`${column.name}\`\n\n` +
            `Data Type: ${column.dataType}\n` +
            `Table: ${column.fullyQualifiedTableName}\n` +
            `Nullable: ${column.isNullable ? 'Yes' : 'No'}` +
            (column.isPrimaryKey ? '\n**Primary Key**' : '')
        );

        // ✅ ÇOK ÖNEMLİ: En yüksek priority ver (! ile başlayarak)
        item.sortText = column.isPrimaryKey ? `!000_${column.name}` : `!001_${column.name}`;
        item.filterText = `${column.name} ${column.dataType}`;

        // ✅ Completion item'ın önceliğini maksimum artır
        item.preselect = column.isPrimaryKey; // PK'ları pre-select et

        // ✅ Çok yüksek priority için importance ekle
        item.tags = []; // No deprecated tags

        // ✅ Replace range belirt ki diğer completion'lar ile karışmasın
        item.range = new vscode.Range(
            new vscode.Position(0, 0),
            new vscode.Position(0, 0)
        );

        return item;
    }
}