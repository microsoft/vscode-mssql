We need more info to debug your particular issue. If you could attach your logs to the issue (ensure no private data is in them), it would help us fix the issue much faster.

### Steps to Collect Logs

1. **Enable Detailed Logging**
   - Open the **Settings** page.
   - Find the `Mssql: Tracing Level` setting and change it to **All**.
   - Restart **VS Code**.

2. **Set Log Level to Trace**
   - Open the Command Palette (`View -> Command Palette`).
   - Run the command: `Developer: Set Log Level...`
   - Set the level to **Trace**.

3. **Reproduce the Issue**
   - Perform the actions that lead to the issue.

4. **Collect the Following Logs**

   #### Console Logs
   - Open **Developer Tools** (`Help -> Toggle Developer Tools`).
   - Click the **Console** tab.
   - Click in the log area and press `CTRL+A` to select all text.
   - Copy and save the text into a file named `console.log`.
   - Attach `console.log` to the issue.
   - Close Developer Tools via `Help -> Toggle Developer Tools`.

   #### Application Logs
   - Open the Command Palette (`View -> Command Palette`).
   - Run the command: `Developer: Open Logs Folder`.
   - This will open the log folder on your machine.
   - **Zip** the entire folder and attach it to the issue.

5. **Revert Logging Settings**
   - After uploading the logs, you can revert the Log/Tracing levels changes made in step 1 and step 2.
