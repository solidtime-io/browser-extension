/**
 * Plane-specific utilities for detecting issue pages and extracting issue information
 */

import { apiClient } from "./api";
import { getCurrentTimeEntry } from "./timeEntries";
import type { CreateTimeEntryBody } from "@solidtime/api";
import { accessToken } from "./oauth";
import { dayjs } from "./dayjs";

export interface PlaneIssueInfo {
  issueKey: string;
  workspaceName: string;
  projectId: string;
  fullUrl: string;
}

const BUTTON_ID = "solidtime-plane-tracking-btn";

/**
 * Checks if the current page is a Plane issue page
 */
export function isPlaneIssuePage(): boolean {
  // Plane issue URLs follow two patterns:
  // 1. https://app.plane.so/{workspaceName}/projects/{projectId}/issues/
  // 2. https://app.plane.so/{workspaceName}/browse/{issueId}
  const projectIssuesPattern = /^\/[^/]+\/projects\/[^/]+\/issues\//;
  const browsePattern = /^\/[^/]+\/browse\/[A-Z]+-\d+/;

  return (
    projectIssuesPattern.test(window.location.pathname) ||
    browsePattern.test(window.location.pathname)
  );
}

/**
 * Extracts issue information from the current Plane issue page
 */
export function getPlaneIssueInfo(): PlaneIssueInfo | null {
  if (!isPlaneIssuePage()) {
    return null;
  }

  // Check if it's the browse URL format: /{workspaceName}/browse/{issueId}
  const browseMatch = window.location.pathname.match(
    /^\/([^/]+)\/browse\/([A-Z]+-\d+)/,
  );
  if (browseMatch) {
    const workspaceName = browseMatch[1];
    const issueKey = browseMatch[2];

    return {
      issueKey,
      workspaceName,
      projectId: "", // Not available in browse URL
      fullUrl: window.location.href,
    };
  }

  // Handle the projects URL format: /{workspaceName}/projects/{projectId}/issues/
  const projectMatch = window.location.pathname.match(
    /^\/([^/]+)\/projects\/([^/]+)\/issues\//,
  );
  if (projectMatch) {
    const workspaceName = projectMatch[1];
    const projectId = projectMatch[2];

    // Try to get issue key from the DOM or URL params
    const issueKey = getIssueKeyFromDOM() || "";

    return {
      issueKey,
      workspaceName,
      projectId,
      fullUrl: window.location.href,
    };
  }

  return null;
}

/**
 * Gets the issue key from the DOM (e.g., "SOLID-7")
 */
function getIssueKeyFromDOM(): string | null {
  // Look for the issue key in the page
  const issueKeyElement = document.querySelector(
    '[class*="text-base"][class*="font-medium"][class*="cursor-pointer"]',
  );

  if (issueKeyElement && issueKeyElement.textContent) {
    const text = issueKeyElement.textContent.trim();
    // Check if it matches the pattern PROJ-123
    if (/^[A-Z]+-\d+$/.test(text)) {
      return text;
    }
  }

  return null;
}

/**
 * Gets the issue title from the DOM
 */
export function getIssueTitleFromDOM(): string | null {
  // Look for the title textarea
  const titleElement = document.querySelector(
    "#title-input",
  ) as HTMLTextAreaElement;

  if (titleElement && titleElement.value) {
    return titleElement.value.trim();
  }

  return null;
}

/**
 * Finds the action buttons wrapper where we should inject the Time Tracking button
 * This is the container with the "Add relation" button
 */
export function findPlaneActionsWrapper(): HTMLElement | null {
  // Find all buttons and look for the one with "Add relation" text
  const buttons = Array.from(document.querySelectorAll("button"));
  const addRelationButton = buttons.find((btn) => {
    const text = btn.textContent?.trim();
    return text === "Add relation";
  });

  if (!addRelationButton) {
    return null;
  }

  // The wrapper is the parent div that contains all these action buttons
  const wrapper = addRelationButton.closest(
    ".flex.items-center.flex-wrap.gap-2",
  );

  return wrapper as HTMLElement;
}

/**
 * Creates the Time Tracking button by extracting and reusing classes from the "Add relation" button
 */
function createPlaneTimeTrackingButton(
  issueDescription: string,
  isTracking: boolean,
): HTMLElement {
  // Find the "Add relation" button to copy its structure
  const buttons = Array.from(document.querySelectorAll("button"));
  const addRelationButton = buttons.find((btn) => {
    const text = btn.textContent?.trim();
    return text === "Add relation";
  });

  if (!addRelationButton) {
    console.warn(
      "Solidtime: Could not find 'Add relation' button for class extraction",
    );
    // Return a basic button as fallback
    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.type = "button";
    button.textContent = isTracking ? "Stop Tracking" : "Start Tracking";
    button.className = "px-3 py-1.5 rounded border text-sm";
    return button;
  }

  // Get the inner div with the classes
  const innerDiv = addRelationButton.querySelector(
    ".h-full.w-min.whitespace-nowrap",
  );

  // Create button wrapper (if needed)
  const buttonWrapper = document.createElement("div");
  buttonWrapper.className = addRelationButton.parentElement?.className || "";

  // Create button
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = addRelationButton.className;

  // Create inner div
  const innerDivClone = document.createElement("div");
  if (innerDiv) {
    innerDivClone.className = innerDiv.className;
  } else {
    innerDivClone.className =
      "h-full w-min whitespace-nowrap flex items-center gap-2 border border-custom-border-200 rounded px-3 py-1.5 cursor-pointer text-custom-text-300 hover:bg-custom-background-80";
  }

  // Create SVG icon (play/stop)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.classList.add("h-3.5", "w-3.5", "flex-shrink-0");
  svg.setAttribute("color", isTracking ? "#DE350B" : "currentColor");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", isTracking ? "#DE350B" : "currentColor");

  if (isTracking) {
    // Stop icon (square)
    path.setAttribute(
      "d",
      "M4 3C3.44772 3 3 3.44772 3 4V12C3 12.5523 3.44772 13 4 13H12C12.5523 13 13 12.5523 13 12V4C13 3.44772 12.5523 3 12 3H4Z",
    );
  } else {
    // Play icon (triangle)
    path.setAttribute(
      "d",
      "M5.5 3.5C5.5 2.67157 6.42157 2.17157 7.08579 2.58579L12.5858 6.08579C13.1716 6.45098 13.1716 7.54902 12.5858 7.91421L7.08579 11.4142C6.42157 11.8284 5.5 11.3284 5.5 10.5V3.5Z",
    );
  }

  svg.appendChild(path);

  // Create text span
  const textSpan = document.createElement("span");
  textSpan.className = "text-sm font-medium";
  textSpan.textContent = isTracking ? "Stop Tracking" : "Start Tracking";

  // Assemble the structure
  innerDivClone.appendChild(svg);
  innerDivClone.appendChild(textSpan);
  button.appendChild(innerDivClone);

  // If the original button has a wrapper, use it
  if (addRelationButton.parentElement?.classList.contains("relative")) {
    buttonWrapper.appendChild(button);
    return buttonWrapper;
  }

  return button;
}

/**
 * Injects the Time Tracking button into the Plane actions wrapper
 */
export async function injectPlaneTimeTrackingButton(
  actionsWrapper: HTMLElement,
  issueDescription: string,
  skipExistingCheck = false,
): Promise<void> {
  // Check if button already exists and skip if so (unless explicitly told to replace)
  const existingButton = document.getElementById(BUTTON_ID);
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
  const button = createPlaneTimeTrackingButton(issueDescription, isTracking);

  // Insert the button at the end of the actions wrapper
  actionsWrapper.appendChild(button);

  // Add click handler
  const buttonElement = document.getElementById(BUTTON_ID);
  if (buttonElement) {
    buttonElement.addEventListener("click", () =>
      handlePlaneTrackingClick(issueDescription, isTracking),
    );
  }
}

/**
 * Handles the Start/Stop Tracking button click
 */
async function handlePlaneTrackingClick(
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
    const actionsWrapper = findPlaneActionsWrapper();
    if (actionsWrapper) {
      await injectPlaneTimeTrackingButton(
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
export function removePlaneTimeTrackingButton(): void {
  const button = document.getElementById(BUTTON_ID);
  if (button) {
    button.remove();
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
export function observePlaneUrlChanges(callback: () => void): void {
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
export function observePlaneActionsWrapper(
  issueDescription: string,
): MutationObserver {
  let isReinjecting = false;
  let checkScheduled = false;

  const checkAndReinject = async () => {
    checkScheduled = false;

    if (isReinjecting) {
      return;
    }

    const buttonExists = document.getElementById(BUTTON_ID);

    if (!buttonExists && isPlaneIssuePage()) {
      isReinjecting = true;

      try {
        const actionsWrapper = findPlaneActionsWrapper();

        if (actionsWrapper) {
          await injectPlaneTimeTrackingButton(actionsWrapper, issueDescription);
        }
      } catch (error) {
        console.error("Solidtime: Failed to re-inject button:", error);
      } finally {
        setTimeout(() => {
          isReinjecting = false;
        }, 100);
      }
    }
  };

  const observer = new MutationObserver((mutations) => {
    if (!checkScheduled) {
      checkScheduled = true;
      requestAnimationFrame(checkAndReinject);
    }
  });

  // Find the main content area to observe
  const mainContent =
    document.querySelector(".h-full.w-full.overflow-hidden") || document.body;

  observer.observe(mainContent, {
    childList: true,
    subtree: true,
  });

  return observer;
}
