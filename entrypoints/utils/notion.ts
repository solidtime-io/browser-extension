/**
 * Notion-specific utilities for detecting database item pages (e.g. tasks)
 * and injecting a Start/Stop timer button. Everything is read from the DOM.
 */

import { apiClient } from "./api";
import { getCurrentTimeEntry } from "./timeEntries";
import type { CreateTimeEntryBody } from "@solidtime/api";
import { accessToken } from "./oauth";
import { dayjs } from "./dayjs";

export interface NotionPageInfo {
  pageId: string | null;
  title: string | null;
  inPeek: boolean;
  fullUrl: string;
}

const BUTTON_ID = "solidtime-notion-tracking-btn";

const TITLE_SELECTOR = 'h1[role="textbox"][aria-roledescription="page title"]';
const PEEK_SELECTOR = ".notion-peek-renderer";
const SHARE_SELECTOR = ".notion-topbar-share-menu";
const PROPERTIES_ROW_SELECTOR = "[data-pinned-row]";
const COLLECTION_VIEW_SELECTOR = ".notion-collection-view-body";

/**
 * Returns the side/center peek element if one is currently open.
 * The peek renderer is always in the DOM, but it is aria-hidden and empty
 * while closed.
 */
function getOpenPeek(): HTMLElement | null {
  const peek = document.querySelector<HTMLElement>(PEEK_SELECTOR);
  if (!peek) {
    return null;
  }
  const isHidden = peek.getAttribute("aria-hidden") === "true";
  if (isHidden && !peek.querySelector(TITLE_SELECTOR)) {
    return null;
  }
  return peek;
}

/**
 * The element holding the page we care about: the open peek, otherwise the
 * whole document. With a peek open the background page has its own title,
 * so lookups must be scoped to the peek.
 */
function getPageRoot(): ParentNode {
  return getOpenPeek() ?? document;
}

/**
 * Checks if the current page (or open peek) is a database item.
 * A database item has a properties block ([data-pinned-row] or a table that
 * is not part of a collection view). The database page itself has neither.
 * Attributes like aria-label are localized, so they are not used.
 */
export function isNotionDatabaseItemPage(): boolean {
  const root = getPageRoot();

  if (!root.querySelector(TITLE_SELECTOR)) {
    return false;
  }

  if (root.querySelector(PROPERTIES_ROW_SELECTOR)) {
    return true;
  }

  return Array.from(root.querySelectorAll('[role="table"]')).some(
    (table) => !table.closest(COLLECTION_VIEW_SELECTOR),
  );
}

/**
 * Extracts page information from the current Notion page or peek
 */
export function getNotionPageInfo(): NotionPageInfo | null {
  if (!isNotionDatabaseItemPage()) {
    return null;
  }

  const inPeek = getOpenPeek() !== null;
  const url = new URL(window.location.href);

  // In a peek the pathname is the database, the item is in ?p=
  const peekId = url.searchParams.get("p");
  const pathId = url.pathname.match(/([0-9a-f]{32})\/?$/i)?.[1];
  const pageId = (inPeek && peekId ? peekId : pathId) ?? null;

  return {
    pageId,
    title: getIssueTitleFromDOM(),
    inPeek,
    fullUrl: window.location.href,
  };
}

/**
 * Gets the page title from the DOM (scoped to the peek when one is open)
 */
export function getIssueTitleFromDOM(): string | null {
  const titleElement = getPageRoot().querySelector(TITLE_SELECTOR);
  const title = titleElement?.textContent?.trim();
  return title ? title : null;
}

/**
 * Finds the container with the Share button where the timer button goes
 * (inside the peek when open, otherwise in the page header).
 * Returns null on pages that are not database items.
 */
export function findNotionActionsWrapper(): HTMLElement | null {
  if (!isNotionDatabaseItemPage()) {
    return null;
  }

  const peek = getOpenPeek();
  const share = peek
    ? peek.querySelector<HTMLElement>(SHARE_SELECTOR)
    : Array.from(
        document.querySelectorAll<HTMLElement>(`header ${SHARE_SELECTOR}`),
      ).find((element) => !element.closest(PEEK_SELECTOR));

  return share?.parentElement ?? null;
}

/**
 * Creates the Time Tracking button. Colors come from Notion's CSS variables,
 * so it follows the light/dark theme.
 */
function createNotionTimeTrackingButton(isTracking: boolean): HTMLElement {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";

  Object.assign(button.style, {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    height: "28px",
    padding: "0 8px",
    marginRight: "4px",
    border: "none",
    borderRadius: "6px",
    background: "transparent",
    color: "var(--c-texPri, currentColor)",
    font: "inherit",
    fontSize: "14px",
    fontWeight: "500",
    whiteSpace: "nowrap",
    cursor: "pointer",
  });

  button.addEventListener("mouseenter", () => {
    button.style.background = "var(--ca-bacIntTra, rgba(127, 127, 127, 0.15))";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "transparent";
  });

  const color = isTracking ? "#DE350B" : "currentColor";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.style.flexShrink = "0";

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", color);
  path.setAttribute(
    "d",
    isTracking
      ? // Stop icon (square)
        "M4 3C3.44772 3 3 3.44772 3 4V12C3 12.5523 3.44772 13 4 13H12C12.5523 13 13 12.5523 13 12V4C13 3.44772 12.5523 3 12 3H4Z"
      : // Play icon (triangle)
        "M5.5 3.5C5.5 2.67157 6.42157 2.17157 7.08579 2.58579L12.5858 6.08579C13.1716 6.45098 13.1716 7.54902 12.5858 7.91421L7.08579 11.4142C6.42157 11.8284 5.5 11.3284 5.5 10.5V3.5Z",
  );
  svg.appendChild(path);

  const textSpan = document.createElement("span");
  textSpan.textContent = isTracking ? "Stop Tracking" : "Start Tracking";
  if (isTracking) {
    textSpan.style.color = color;
  }

  button.appendChild(svg);
  button.appendChild(textSpan);

  return button;
}

/**
 * Injects the Time Tracking button to the left of the Share button.
 * The description is not passed in: it is read from the page title when the
 * button is clicked, so renames between inject and click are picked up.
 */
export async function injectNotionTimeTrackingButton(
  actionsWrapper: HTMLElement,
  skipExistingCheck = false,
): Promise<void> {
  if (document.getElementById(BUTTON_ID) && !skipExistingCheck) {
    return;
  }

  const startHref = window.location.href;

  // Check if there's a current time entry
  let isTracking = false;
  try {
    if (accessToken.value) {
      const currentEntry = await getCurrentTimeEntry();
      isTracking = currentEntry?.data?.id ? true : false;
    }
  } catch (error) {
    console.error("Failed to get current time entry:", error);
  }

  // Navigated away or the topbar was re-rendered while waiting for the API
  if (window.location.href !== startHref || !actionsWrapper.isConnected) {
    return;
  }

  // Re-check after the await so concurrent injections cannot add two buttons
  const existingButton = document.getElementById(BUTTON_ID);
  if (existingButton) {
    if (!skipExistingCheck) {
      return;
    }
    existingButton.remove();
  }

  const button = createNotionTimeTrackingButton(isTracking);
  button.addEventListener("click", () => handleNotionTrackingClick(isTracking));

  const share = actionsWrapper.querySelector<HTMLElement>(
    `:scope > ${SHARE_SELECTOR}`,
  );
  if (share) {
    actionsWrapper.insertBefore(button, share);
  } else {
    actionsWrapper.prepend(button);
  }
}

/**
 * Handles the Start/Stop Tracking button click
 */
async function handleNotionTrackingClick(
  isCurrentlyTracking: boolean,
): Promise<void> {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;

  // Disable button during API call
  button.setAttribute("disabled", "true");
  button.style.opacity = "0.5";
  button.style.cursor = "not-allowed";

  try {
    if (!accessToken.value) {
      alert("Please log in to Solidtime first by clicking the extension icon");
      return;
    }

    const client = apiClient();

    if (isCurrentlyTracking) {
      // Stop current time entry
      const currentEntry = await getCurrentTimeEntry();
      if (currentEntry?.data?.id) {
        await client.updateTimeEntry(
          {
            ...currentEntry.data,
            end: dayjs.utc().format(),
          },
          {
            params: {
              organization: currentEntry.data.organization_id,
              timeEntry: currentEntry.data.id,
            },
          },
        );
      }
    } else {
      // Start new time entry
      const storage = await browser.storage.local.get([
        "current_organization_id",
        "currentMembershipId",
      ]);
      const organizationId = storage.current_organization_id as
        string | undefined;
      const membershipId = storage.currentMembershipId as string | undefined;

      if (!organizationId || !membershipId) {
        alert("Please select an organization in the Solidtime extension first");
        return;
      }

      // Read the title now, not at inject time
      const description = getIssueTitleFromDOM() || "Untitled";

      const timeEntryData: CreateTimeEntryBody = {
        member_id: membershipId,
        description,
        start: dayjs.utc().format(),
        billable: false,
      };

      await client.createTimeEntry(timeEntryData, {
        params: {
          organization: organizationId,
        },
      });
    }

    // Refresh the button
    const actionsWrapper = findNotionActionsWrapper();
    if (actionsWrapper) {
      await injectNotionTimeTrackingButton(actionsWrapper, true);
    }
  } catch (error) {
    console.error("Failed to toggle time tracking:", error);
    alert(
      "Failed to toggle time tracking. Please make sure you are logged in.",
    );
  } finally {
    // The button may have been replaced by the refresh above
    const current = document.getElementById(BUTTON_ID);
    if (current) {
      current.removeAttribute("disabled");
      current.style.opacity = "1";
      current.style.cursor = "pointer";
    }
  }
}

/**
 * Removes the Time Tracking button
 */
export function removeNotionTimeTrackingButton(): void {
  document.getElementById(BUTTON_ID)?.remove();
}

/**
 * Waits for an element to appear in the DOM.
 * Polls instead of using requestAnimationFrame: Notion is heavy and pages
 * that are not database items never match, so this keeps the idle cost low.
 */
export function waitForElement(
  selector: string | (() => HTMLElement | null),
  timeout = 5000,
): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const check = () => {
      const element =
        typeof selector === "function"
          ? selector()
          : document.querySelector<HTMLElement>(selector);

      if (element) {
        resolve(element);
        return;
      }

      if (Date.now() - startTime > timeout) {
        reject(new Error("Element not found within timeout"));
        return;
      }

      setTimeout(check, 200);
    };

    check();
  });
}

/**
 * Watches for navigation (Notion is an SPA). Peek open/close and switching
 * items inside a peek change only the query string, so the whole href is
 * compared. Polling avoids a MutationObserver on the whole of Notion's body.
 * Returns a function that stops watching.
 */
export function observeNotionUrlChanges(callback: () => void): () => void {
  let lastUrl = window.location.href;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const check = () => {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) {
      return;
    }
    lastUrl = currentUrl;

    // Let Notion render the new page before reacting
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(callback, 150);
  };

  const interval = setInterval(check, 300);
  window.addEventListener("popstate", check);

  return () => {
    clearInterval(interval);
    window.removeEventListener("popstate", check);
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
  };
}

/**
 * Observes the topbar (or the open peek) and re-injects the button if Notion
 * re-renders it away. Throttled to one check per animation frame. The caller
 * must disconnect the returned observer on navigation.
 */
export function observeNotionActionsWrapper(): MutationObserver {
  let isReinjecting = false;
  let checkScheduled = false;

  const checkAndReinject = async () => {
    checkScheduled = false;

    if (isReinjecting || document.getElementById(BUTTON_ID)) {
      return;
    }

    isReinjecting = true;

    try {
      const actionsWrapper = findNotionActionsWrapper();

      if (actionsWrapper) {
        await injectNotionTimeTrackingButton(actionsWrapper);
      }
    } catch (error) {
      console.error("Solidtime: Failed to re-inject button:", error);
    } finally {
      setTimeout(() => {
        isReinjecting = false;
      }, 100);
    }
  };

  const observer = new MutationObserver(() => {
    if (!checkScheduled) {
      checkScheduled = true;
      requestAnimationFrame(checkAndReinject);
    }
  });

  const target =
    getOpenPeek() ?? document.querySelector("header") ?? document.body;

  observer.observe(target, {
    childList: true,
    subtree: true,
  });

  return observer;
}
