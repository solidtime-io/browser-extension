/**
 * Jira-specific utilities for detecting issue pages and extracting issue information
 */

import { apiClient } from "./api";
import { getCurrentTimeEntry } from "./timeEntries";
import type { CreateTimeEntryBody } from "@solidtime/api";
import { accessToken } from "./oauth";
import { dayjs } from "./dayjs";

export interface JiraIssueInfo {
  issueKey: string;
  workspaceName: string;
  projectName: string;
  fullUrl: string;
}

const BUTTON_WRAPPER_ID = "solidtime-jira-button-wrapper";
const BUTTON_ID = "solidtime-jira-tracking-btn";

/**
 * Checks if the current page is a Jira issue page
 */
export function isJiraIssuePage(): boolean {
  // Jira issue URLs follow two patterns:
  // 1. https://{workspace}.atlassian.net/jira/software/projects/{project}/boards/1?selectedIssue={issue}
  // 2. https://{workspace}.atlassian.net/browse/{issueId}
  const boardUrlPattern = /^\/jira\/software\/projects\/.+\/boards\/\d+/;
  const hasSelectedIssue = window.location.search.includes("selectedIssue=");
  const isBoardView =
    boardUrlPattern.test(window.location.pathname) && hasSelectedIssue;

  const browseUrlPattern = /^\/browse\/[A-Z]+-\d+/;
  const isBrowseView = browseUrlPattern.test(window.location.pathname);

  return isBoardView || isBrowseView;
}

/**
 * Extracts issue information from the current Jira issue page
 */
export function getJiraIssueInfo(): JiraIssueInfo | null {
  if (!isJiraIssuePage()) {
    return null;
  }

  // Extract workspace name from hostname
  const hostnameMatch = window.location.hostname.match(
    /^(.+)\.atlassian\.net$/,
  );
  const workspaceName = hostnameMatch ? hostnameMatch[1] : "";

  // Check if it's the browse URL format: /browse/{issueId}
  const browseMatch = window.location.pathname.match(/^\/browse\/([A-Z]+-\d+)/);
  if (browseMatch) {
    const issueKey = browseMatch[1];
    // Extract project name from issue key (e.g., "PROJ-123" -> "PROJ")
    const projectName = issueKey.split("-")[0];

    return {
      issueKey,
      workspaceName,
      projectName,
      fullUrl: window.location.href,
    };
  }

  // Otherwise, handle the board URL format
  // Extract project name from URL path
  const pathMatch = window.location.pathname.match(
    /\/jira\/software\/projects\/([^/]+)\//,
  );
  const projectName = pathMatch ? pathMatch[1] : "";

  // Extract issue key from URL query parameter
  const urlParams = new URLSearchParams(window.location.search);
  const issueKey = urlParams.get("selectedIssue") || "";

  return {
    issueKey,
    workspaceName,
    projectName,
    fullUrl: window.location.href,
  };
}

/**
 * Gets the issue title/summary from the DOM
 */
export function getIssueTitleFromDOM(): string | null {
  // Look for the issue title in Jira's DOM structure
  const titleElement =
    document.querySelector(
      '[data-testid*="issue.views.field.rich-text.heading"]',
    ) ||
    document.querySelector('h1[data-testid*="issue"]') ||
    document.querySelector(
      '[data-component-selector*="issue-view-common-heading"]',
    );

  if (titleElement) {
    return titleElement.textContent?.trim() || null;
  }

  return null;
}

/**
 * Finds the actions wrapper where we should inject the Time Tracking button
 */
export function findJiraActionsWrapper(): HTMLElement | null {
  const actionsWrapper = document.querySelector(
    '[data-testid="issue.views.issue-base.foundation.status.actions-wrapper"]',
  ) as HTMLElement;

  return actionsWrapper;
}

/**
 * Extracts button classes from the Automation button in the actions wrapper
 */
function extractJiraButtonClasses() {
  const actionsWrapper = findJiraActionsWrapper();
  if (!actionsWrapper) {
    console.warn(
      "Solidtime: Could not find actions wrapper for class extraction",
    );
    return {
      wrapperDivClass: "",
      buttonClass: "",
      contentSpanClass: "",
      iconSpanClass: "",
      textSpanClass: "",
      svgClass: "",
    };
  }

  // Find the existing button (Automation button) to copy its structure
  const existingButton = actionsWrapper.querySelector("button");
  if (!existingButton) {
    console.warn(
      "Solidtime: Could not find existing button for class extraction",
    );
    return {
      wrapperDivClass: "",
      buttonClass: "",
      contentSpanClass: "",
      iconSpanClass: "",
      textSpanClass: "",
      svgClass: "",
    };
  }

  // Get the wrapper div (parent of button) - has css-* class
  const wrapperDiv = existingButton.parentElement;

  // Get the content span (first child of button)
  const contentSpan = existingButton.children[0] as HTMLElement;

  // Get the icon span (first child of content span)
  const iconSpan = contentSpan?.children[0] as HTMLElement;

  // Get the text span (second child of content span)
  const textSpan = contentSpan?.children[1] as HTMLElement;

  // Get the SVG element
  const svg = iconSpan?.querySelector("svg");

  return {
    wrapperDivClass: wrapperDiv?.className || "",
    buttonClass: existingButton?.className || "",
    contentSpanClass: contentSpan?.className || "",
    iconSpanClass: iconSpan?.className || "",
    textSpanClass: textSpan?.className || "",
    svgClass: svg?.getAttribute("class") || "",
  };
}

/**
 * Creates the Time Tracking button by extracting and reusing classes from existing buttons
 */
function createJiraTimeTrackingButton(
  issueDescription: string,
  isTracking: boolean,
): HTMLElement {
  // Extract classes from existing buttons
  const classes = extractJiraButtonClasses();

  // Create wrapper div
  const wrapperDiv = document.createElement("div");
  wrapperDiv.id = BUTTON_WRAPPER_ID;
  wrapperDiv.className = classes.wrapperDivClass;
  wrapperDiv.style.marginLeft = "8px";

  // Create button
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.className = classes.buttonClass;
  button.type = "button";

  // Create content span
  const contentSpan = document.createElement("span");
  contentSpan.className = classes.contentSpanClass;

  // Create icon span
  const iconSpan = document.createElement("span");
  iconSpan.className = classes.iconSpanClass;
  iconSpan.setAttribute("aria-hidden", "true");
  iconSpan.style.cssText = "color: currentcolor;";

  // Create SVG icon
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("fill", "none");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("role", "presentation");
  if (classes.svgClass) {
    svg.setAttribute("class", classes.svgClass);
  }

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", isTracking ? "#DE350B" : "currentcolor");

  if (isTracking) {
    // Stop icon (square)
    path.setAttribute(
      "d",
      "M4 3C3.44772 3 3 3.44772 3 4V12C3 12.5523 3.44772 13 4 13H12C12.5523 13 13 12.5523 13 12V4C13 3.44772 12.5523 3 12 3H4Z",
    );
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("clip-rule", "evenodd");
  } else {
    // Play icon (triangle)
    path.setAttribute(
      "d",
      "M5.5 3.5C5.5 2.67157 6.42157 2.17157 7.08579 2.58579L12.5858 6.08579C13.1716 6.45098 13.1716 7.54902 12.5858 7.91421L7.08579 11.4142C6.42157 11.8284 5.5 11.3284 5.5 10.5V3.5Z",
    );
  }

  svg.appendChild(path);
  iconSpan.appendChild(svg);

  // Create text span
  const textSpan = document.createElement("span");
  textSpan.className = classes.textSpanClass;
  textSpan.textContent = isTracking ? "Stop Timer" : "Start Timer";

  // Assemble the structure
  contentSpan.appendChild(iconSpan);
  contentSpan.appendChild(textSpan);
  button.appendChild(contentSpan);
  wrapperDiv.appendChild(button);

  return wrapperDiv;
}

/**
 * Injects the Time Tracking button into the Jira actions wrapper
 */
export async function injectJiraTimeTrackingButton(
  actionsWrapper: HTMLElement,
  issueDescription: string,
  skipExistingCheck = false,
): Promise<void> {
  // Check if button already exists and skip if so (unless explicitly told to replace)
  const existingButton = document.getElementById(BUTTON_WRAPPER_ID);
  if (existingButton && !skipExistingCheck) {
    return;
  }

  // Remove existing button if present
  if (existingButton) {
    existingButton.remove();
  }

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

  // Create the button
  const buttonWrapper = createJiraTimeTrackingButton(
    issueDescription,
    isTracking,
  );

  // Insert the button at the end of the actions wrapper
  actionsWrapper.appendChild(buttonWrapper);

  // Add click handler
  const button = document.getElementById(BUTTON_ID);
  if (button) {
    button.addEventListener("click", () =>
      handleJiraTrackingClick(issueDescription, isTracking),
    );
  }
}

/**
 * Handles the Start/Stop Tracking button click
 */
async function handleJiraTrackingClick(
  issueDescription: string,
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
      const organizationId = storage.current_organization_id;
      const membershipId = storage.currentMembershipId;

      if (!organizationId || !membershipId) {
        alert("Please select an organization in the Solidtime extension first");
        return;
      }

      const timeEntryData: CreateTimeEntryBody = {
        member_id: membershipId,
        description: issueDescription,
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
    const actionsWrapper = findJiraActionsWrapper();
    if (actionsWrapper) {
      await injectJiraTimeTrackingButton(
        actionsWrapper,
        issueDescription,
        true,
      );
    }
  } catch (error) {
    console.error("Failed to toggle time tracking:", error);
    alert(
      "Failed to toggle time tracking. Please make sure you are logged in.",
    );
  } finally {
    // Re-enable button
    if (button) {
      button.removeAttribute("disabled");
      button.style.opacity = "1";
      button.style.cursor = "pointer";
    }
  }
}

/**
 * Removes the Time Tracking button
 */
export function removeJiraTimeTrackingButton(): void {
  const buttonWrapper = document.getElementById(BUTTON_WRAPPER_ID);
  if (buttonWrapper) {
    buttonWrapper.remove();
  }
}

/**
 * Waits for an element to appear in the DOM
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

      requestAnimationFrame(check);
    };

    check();
  });
}

/**
 * Creates a URL observer to watch for issue changes
 */
export function observeJiraUrlChanges(callback: () => void): void {
  let lastUrl = window.location.href;

  const observer = new MutationObserver(() => {
    const currentUrl = window.location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      callback();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });

  // Also listen to popstate for browser back/forward
  window.addEventListener("popstate", callback);
}

/**
 * Observes the DOM for changes and re-injects the button if it gets removed
 * Uses a throttled approach to minimize performance impact
 */
export function observeJiraActionsWrapper(
  issueDescription: string,
): MutationObserver {
  let isReinjecting = false; // Flag to prevent infinite loops
  let checkScheduled = false; // Throttling flag

  const checkAndReinject = async () => {
    checkScheduled = false;

    // Prevent re-injection loops
    if (isReinjecting) {
      return;
    }

    // Check if our button still exists
    const buttonExists = document.getElementById(BUTTON_WRAPPER_ID);

    if (!buttonExists && isJiraIssuePage()) {
      isReinjecting = true;

      try {
        // Try to find the actions wrapper again
        const actionsWrapper = findJiraActionsWrapper();

        if (actionsWrapper) {
          // Re-inject the button
          await injectJiraTimeTrackingButton(actionsWrapper, issueDescription);
        }
      } catch (error) {
        console.error("Solidtime: Failed to re-inject button:", error);
      } finally {
        // Reset the flag after a short delay to allow for the DOM to settle
        setTimeout(() => {
          isReinjecting = false;
        }, 100);
      }
    }
  };

  const observer = new MutationObserver((mutations) => {
    // Throttle checks: only schedule one check per animation frame
    if (!checkScheduled) {
      checkScheduled = true;
      requestAnimationFrame(checkAndReinject);
    }
  });

  // Find the closest common parent to observe
  // This is usually the main content area where Jira renders issue details
  const mainContent =
    document.querySelector(
      '[data-testid="issue.views.issue-base.foundation.main"]',
    ) ||
    document.querySelector("main") ||
    document.body;

  // Observe changes in the main content area
  observer.observe(mainContent, {
    childList: true,
    subtree: true,
  });

  return observer;
}
