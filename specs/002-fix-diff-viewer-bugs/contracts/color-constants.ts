/**
 * Color Constants Contract
 * 
 * Standardized color definitions for diff viewer components.
 * All components MUST use these constants to ensure visual consistency.
 * 
 * @see FR-001 in spec.md
 */

/**
 * CSS variable strings for diff change type colors.
 * Use these in makeStyles, inline styles, and CSS files.
 */
export const DIFF_COLORS = {
  /** Green color for additions */
  addition: "var(--vscode-gitDecoration-addedResourceForeground, #73c991)",
  /** Amber/yellow color for modifications */
  modification: "var(--vscode-gitDecoration-modifiedResourceForeground, #e2c08d)",
  /** Red color for deletions */
  deletion: "var(--vscode-gitDecoration-deletedResourceForeground, #c74e39)",
} as const;

/**
 * Type for valid diff color keys
 */
export type DiffColorType = keyof typeof DIFF_COLORS;

/**
 * Get the appropriate color for a change type
 * @param changeType The schema change type
 * @returns CSS variable string with fallback
 */
export function getDiffColor(changeType: "Addition" | "Modification" | "Deletion"): string {
  switch (changeType) {
    case "Addition":
      return DIFF_COLORS.addition;
    case "Modification":
      return DIFF_COLORS.modification;
    case "Deletion":
      return DIFF_COLORS.deletion;
  }
}
