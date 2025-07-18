# Hot Exit Support for SQL Queries

## Overview

This extension now supports VSCode's Hot Exit feature for untitled SQL query documents. Hot Exit allows you to close VSCode with unsaved changes and have those changes automatically restored when you reopen VSCode.

## How It Works

When you have unsaved changes in an untitled SQL query document and close VSCode:

1. **Before this fix**: You would be prompted to save the document
2. **After this fix**: VSCode automatically backs up the document and restores it when you reopen VSCode

## Requirements

- VSCode's `files.hotExit` setting must be enabled (default is `"onExit"`)
- The document must be an untitled SQL document (created via "New Query" command)
- The document must have unsaved changes

## Configuration

No additional configuration is required. The extension will automatically defer to VSCode's built-in Hot Exit mechanism for untitled SQL documents with unsaved changes.

## Technical Details

The fix modifies the `onDidCloseTextDocument` handler in the main controller to:

1. Check if the document is an untitled SQL document with unsaved changes
2. Skip the extension's special processing for such documents
3. Allow VSCode's Hot Exit mechanism to handle the backup/restore process

This ensures that the extension doesn't interfere with VSCode's built-in Hot Exit functionality while maintaining all other existing behaviors for saved files and clean documents.