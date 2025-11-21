/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
  Button,
  SearchBox,
  Text,
  makeStyles,
} from "@fluentui/react-components";
import * as FluentIcons from "@fluentui/react-icons";
import { useEffect, useState, useRef, useCallback } from "react";
import { locConstants } from "./locConstants";

// Generic interface for searchable items
export interface SearchableItem {
  id: string;
  getDisplayText: () => string;
  getSearchableText: () => string;
}

export interface FloatingSearchWidgetProps<T extends SearchableItem> {
  /**
   * Function to get the items to be searched.
   * @returns An array of items to be searched.
   */
  getItems: () => T[];
  /**
   * Callback function to be called when an item is selected.
   * @param item The selected item.
   */
  onItemSelected?: (item: T) => void;
  /**
   * Callback function to be called when the search text changes.
   * @param searchText The current search text.
   * @returns void
   */
  onSearch?: (searchText: string) => void;
  /**
   * Placeholder text for the search box.
   */
  placeholder?: string;
  /**
   * Label for the search box, used for accessibility.
   */
  searchLabel?: string;
  /**
   * Label for the next button, used for accessibility.
   */
  nextLabel?: string;
  /**
   * Label for the previous button, used for accessibility.
   */
  previousLabel?: string;
  noResultsText?: string;
  resultSummaryFormat?: string; // Format: "{current} of {total}"
  width?: string;
  emitSearchEvent?: (searchText: string) => void;
  disabled?: boolean; // Whether keyboard shortcuts are disabled
  parentRef?: React.RefObject<HTMLElement>; // Reference to parent container
  zIndex?: number; // z-index for the floating container
}

const useStyles = makeStyles({
  floatingContainer: {
    position: "absolute",
    right: "16px",
    top: "0px",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "var(--vscode-editorWidget-background)",
    boxShadow: "0 0 8px 2px var(--vscode-widget-shadow)",
    borderBottomLeftRadius: "4px",
    borderBottomRightRadius: "4px",
    paddingLeft: "4px",
    paddingRight: "4px",
    paddingTop: "0px",
    paddingBottom: "0px",
    zIndex: "35",
    transform: "translateY(-10px)",
    opacity: "0",
    transition: "opacity 0.2s ease, transform 0.2s ease",
    overflow: "hidden",
    borderLeft: "3px solid var(--vscode-editorWidget-border)",
    height: "33px",
    gap: "3px",
  },
  visible: {
    opacity: "1",
    transform: "translateY(0)",
  },
  invisible: {
    display: "none",
  },
  srOnly: {
    position: "absolute",
    width: "1px",
    height: "1px",
    padding: "0",
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0, 0, 0, 0)",
    whiteSpace: "nowrap",
    border: "0",
  },
});

export function FindWidget<T extends SearchableItem>({
  getItems,
  onItemSelected,
  onSearch,
  placeholder = locConstants.common.find,
  searchLabel = "Search items",
  nextLabel = locConstants.common.findNext,
  previousLabel = locConstants.common.findPrevious,
  width = "200px",
  emitSearchEvent,
  disabled = false,
  parentRef,
  zIndex = 1000,
}: FloatingSearchWidgetProps<T>) {
  const [items, setItems] = useState<T[]>(getItems());
  const [searchText, setSearchText] = useState<string>("");
  const [resultSummary, setResultSummary] = useState<string>(
    locConstants.common.noResults,
  );
  const [filteredItems, setFilteredItems] = useState<T[]>([]);
  const [currentItemIndex, setCurrentItemIndex] = useState<number>(0);
  const [isVisible, setIsVisible] = useState<boolean>(false);
  const searchBoxRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const lastFocusedElement = useRef<HTMLElement | null>(null);
  const styles = useStyles();

  // Filter items based on search text
  const filterItems = (text: string): T[] => {
    if (!text.trim()) return [];

    return items.filter((item) =>
      item.getSearchableText().toLowerCase().includes(text.toLowerCase()),
    );
  };

  // Update the result summary whenever filtered items or current index changes
  useEffect(() => {
    let summary = locConstants.common.noResults;
    if (filteredItems.length > 0) {
      summary = locConstants.common.searchResultSummary(
        currentItemIndex + 1,
        filteredItems.length,
      );
    }
    setResultSummary(summary);

    // Announce the search results to screen readers
    if (statusRef.current) {
      statusRef.current.textContent = searchText
        ? `${summary}${filteredItems.length > 0 ? `. Found "${searchText}" in ${filteredItems[currentItemIndex]?.getDisplayText()}` : ""}`
        : "Search cleared";
    }

    // Notify when an item is selected
    if (filteredItems.length > 0 && onItemSelected) {
      onItemSelected(filteredItems[currentItemIndex]);
    }

    // Emit search event if provided
    if (emitSearchEvent) {
      emitSearchEvent(searchText);
    }
  }, [
    filteredItems,
    currentItemIndex,
    searchText,
    onItemSelected,
    emitSearchEvent,
  ]);

  const handleSearch = (newSearchText: string) => {
    setSearchText(newSearchText);

    if (newSearchText.trim().length === 0) {
      setResultSummary(locConstants.common.noResults);
      setFilteredItems([]);
      setCurrentItemIndex(0);
    } else {
      const filtered = filterItems(newSearchText);
      setFilteredItems(filtered);
      setCurrentItemIndex(filtered.length > 0 ? 0 : 0);
    }

    // Call external onSearch handler if provided
    if (onSearch) {
      onSearch(newSearchText);
    }
  };

  const handleNextItem = () => {
    if (filteredItems.length === 0) return;
    const nextIndex = (currentItemIndex + 1) % filteredItems.length;
    setCurrentItemIndex(nextIndex);
  };

  const handlePreviousItem = () => {
    if (filteredItems.length === 0) return;
    const prevIndex =
      (currentItemIndex - 1 + filteredItems.length) % filteredItems.length;
    setCurrentItemIndex(prevIndex);
  };

  const showSearchWidget = useCallback(() => {
    lastFocusedElement.current = document.activeElement as HTMLElement;
    setIsVisible(true);
    requestAnimationFrame(() => {
      if (searchBoxRef.current) {
        searchBoxRef.current.focus();
      }
    });
  }, []);

  const hideSearchWidget = useCallback(() => {
    setIsVisible(false);
    setSearchText("");
    setFilteredItems([]);
    lastFocusedElement.current?.focus();
  }, []);

  // Set up global keyboard shortcut
  useEffect(() => {
    if (disabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // If the active element is not within the parentRef, do not trigger the shortcut
      if (!parentRef?.current?.contains(document.activeElement)) {
        return;
      }

      let isKeyboardShortcutPressed = event.ctrlKey && event.key === "f";
      // if mac, use metaKey instead of ctrlKey
      const isMac = navigator.userAgent.includes("Macintosh");
      if (isMac) {
        isKeyboardShortcutPressed = event.metaKey && event.key === "f";
      }

      if (isKeyboardShortcutPressed) {
        event.preventDefault();
        if (isVisible) {
          // If already visible, just focus the search box
          if (searchBoxRef.current) {
            searchBoxRef.current.focus();
          }
        } else {
          // Show search widget if not visible
          showSearchWidget();

          // If there's text selected, use it as the search term
          const selectedText = window.getSelection()?.toString();
          if (selectedText) {
            handleSearch(selectedText);
          }
        }
      } else if (event.key === "Escape" && isVisible) {
        // Close search widget on Escape
        hideSearchWidget();
        // shift focus to the parentRef
        if (parentRef?.current) {
          parentRef.current.focus();
        }
        event.preventDefault();
      }
    };

    document.addEventListener("keydown", (event: any) => {
      handleKeyDown(event);
    });

    // Clean up event listener
    return () => {
      document.removeEventListener("keydown", (event: any) => {
        handleKeyDown(event);
      });
    };
  }, [disabled, isVisible, showSearchWidget, hideSearchWidget, parentRef]);

  useEffect(() => {
    setItems(getItems());
  }, [getItems, isVisible]);

  // When items change, update filtered results if search is active
  useEffect(() => {
    if (searchText) {
      const filtered = filterItems(searchText);
      setFilteredItems(filtered);
      setCurrentItemIndex(filtered.length > 0 ? 0 : 0);
    }
  }, [items, searchText]);

  return (
    <div
      ref={containerRef}
      role="search"
      aria-label={searchLabel}
      className={`${styles.floatingContainer} ${isVisible ? styles.visible : styles.invisible}`}
      style={{ zIndex: zIndex }}
    >
      <SearchBox
        size="small"
        placeholder={placeholder}
        value={searchText}
        onChange={(_e, d) => handleSearch(d.value)}
        style={{
          width: width,
          maxWidth: width,
          marginLeft: "17px",
        }}
        ref={searchBoxRef}
        aria-label={searchLabel}
        aria-controls="search-results-status"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            if (e.shiftKey) {
              handlePreviousItem();
              e.preventDefault();
            } else {
              handleNextItem();
              e.preventDefault();
            }
          } else if (e.key === "Escape") {
            hideSearchWidget();
            e.preventDefault();
          }
        }}
      />
      <Text
        size={200}
        style={{
          marginLeft: "5px",
          color:
            filteredItems.length === 0 && searchText
              ? "var(--vscode-errorForeground)"
              : "",
          minWidth: "70px",
        }}
        id="search-results-count"
        aria-live="polite"
      >
        {resultSummary}
      </Text>
      <div
        ref={statusRef}
        id="search-results-status"
        aria-live="polite"
        className={styles.srOnly}
      />
      <Button
        size="small"
        icon={<FluentIcons.ArrowDown16Regular />}
        appearance="subtle"
        disabled={filteredItems.length === 0}
        onClick={handleNextItem}
        title={nextLabel}
        aria-label={nextLabel}
      />
      <Button
        size="small"
        icon={<FluentIcons.ArrowUp16Regular />}
        appearance="subtle"
        disabled={filteredItems.length === 0}
        onClick={handlePreviousItem}
        title={previousLabel}
        aria-label={previousLabel}
      />
      <Button
        size="small"
        icon={<FluentIcons.Dismiss16Regular />}
        appearance="subtle"
        onClick={hideSearchWidget}
        title={locConstants.common.closeFind}
        aria-label={locConstants.common.closeFind}
      />
    </div>
  );
}
