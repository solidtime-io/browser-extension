/**
 * Linear-specific utilities for detecting issue pages and extracting issue information
 */

import { apiClient } from "./api";
import { getCurrentTimeEntry } from "./timeEntries";
import type { CreateTimeEntryBody } from "@solidtime/api";
import { accessToken } from "./oauth";
import { dayjs } from "./dayjs";

export interface LinearIssueInfo {
  issueId: string;
  issueTitle: string;
  projectKey: string;
  fullUrl: string;
}

const SECTION_ID = "solidtime-time-tracking-section";
const BUTTON_ID = "solidtime-start-tracking-btn";

/**
 * Checks if the current page is a Linear issue page
 */
export function isLinearIssuePage(): boolean {
  // Linear issue URLs follow the pattern: https://linear.app/{workspace}/issue/{issueId}/{issueTitle}
  const urlPattern = /^\/[^/]+\/issue\/[^/]+/;
  return urlPattern.test(window.location.pathname);
}

/**
 * Extracts issue information from the current Linear issue page
 */
export function getLinearIssueInfo(): LinearIssueInfo | null {
  if (!isLinearIssuePage()) {
    return null;
  }

  // Parse URL: /workspace/issue/PROJECT-123/issue-title
  const pathMatch = window.location.pathname.match(
    /^\/([^/]+)\/issue\/([^/]+)(?:\/(.+))?/,
  );

  if (!pathMatch) {
    return null;
  }

  const [, workspace, issueId, issueTitle] = pathMatch;

  // Extract project key from issue ID (e.g., "ST" from "ST-583")
  const projectKeyMatch = issueId.match(/^([A-Z]+)-/);
  const projectKey = projectKeyMatch ? projectKeyMatch[1] : "";

  return {
    issueId,
    issueTitle: issueTitle || "",
    projectKey,
    fullUrl: window.location.href,
  };
}

/**
 * Gets the issue title from the DOM
 * This is more reliable than parsing from URL as the URL might be truncated
 */
export function getIssueTitleFromDOM(): string | null {
  // The issue title is in a contenteditable div with role="textbox" and aria-label="Issue title"
  const titleElement = document.querySelector(
    '[aria-label="Issue title"][role="textbox"]',
  );

  if (titleElement) {
    return titleElement.textContent?.trim() || null;
  }

  return null;
}

/**
 * Finds the properties sidebar container where we should inject the time tracking section
 * We look for the direct container that holds sections like "Labels", "Cycle", "Project"
 */
export function findPropertiesSidebar(): HTMLElement | null {
  // Find all sections that have "Labels", "Cycle", or "Project" text
  const labelsSections = Array.from(document.querySelectorAll("span")).filter(
    (el) => {
      const text = el.textContent?.trim();
      return text === "Labels" || text === "Cycle" || text === "Project";
    },
  );

  if (labelsSections.length === 0) {
    return null;
  }

  // Get the parent container of the first found section
  // We need to find the common parent that contains all these sections
  const firstSection = labelsSections[0];
  let container = firstSection.parentElement;

  // Walk up to find the container that holds all the property section divs
  for (let i = 0; i < 10 && container; i++) {
    container = container.parentElement;

    if (!container) break;

    // Check if this container directly contains multiple property sections
    const directChildren = Array.from(container.children);
    const sectionChildren = directChildren.filter((child) => {
      const childText = child.textContent || "";
      return (
        childText.includes("Labels") ||
        childText.includes("Cycle") ||
        childText.includes("Project")
      );
    });

    // If we found a container with at least 2 direct children that are property sections
    if (sectionChildren.length >= 2) {
      return container as HTMLElement;
    }
  }

  return null;
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
 * Creates a MutationObserver to watch for URL changes in Single Page Applications
 */
export function observeUrlChanges(callback: () => void): MutationObserver {
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

  return observer;
}

/**
 * Extracts classes from existing Linear elements to match their styling
 */
function extractLinearClasses() {
  // Find the Project span to use as a template
  const projectSpan = Array.from(document.querySelectorAll("span")).find(
    (el) => el.textContent?.trim() === "Project",
  );

  if (!projectSpan) {
    return {
      sectionWrapperClass: "",
      headerWrapperClass: "",
      labelSpanClass: "",
      buttonOuterContainerClass: "",
      buttonWrapperClass: "",
      buttonClass: "",
      buttonTextSpanClass: "",
    };
  }

  // Navigate up to get the section wrapper (should have exactly 2 div children)
  let sectionWrapper = projectSpan.parentElement;
  while (sectionWrapper && sectionWrapper.children.length !== 2) {
    sectionWrapper = sectionWrapper.parentElement;
  }

  // The header wrapper is the first child of the section
  const headerWrapper = sectionWrapper?.children[0] as HTMLElement;

  // The label span
  const labelSpan = projectSpan;

  // The button outer container is the second child of the section
  const buttonOuterContainer = sectionWrapper?.children[1] as HTMLElement;

  // The button wrapper is the first child of the button container
  const buttonWrapper = buttonOuterContainer?.children[0] as HTMLElement;

  // The button is inside the button wrapper
  const button = buttonWrapper?.querySelector("button");

  // The button text span (last span in the button)
  const buttonTextSpan = button?.querySelector("span:last-child");

  return {
    sectionWrapperClass: sectionWrapper?.className || "",
    headerWrapperClass: headerWrapper?.className || "",
    labelSpanClass: labelSpan?.className || "",
    buttonOuterContainerClass: buttonOuterContainer?.className || "",
    buttonWrapperClass: buttonWrapper?.className || "",
    buttonClass: button?.className || "",
    buttonTextSpanClass: buttonTextSpan?.className || "",
  };
}

/**
 * Creates the Time Tracking section HTML
 */
function createTimeTrackingSection(
  issueDescription: string,
  isTracking: boolean,
): HTMLElement {
  // Extract classes from existing Linear elements
  const classes = extractLinearClasses();

  // Outer section wrapper
  const section = document.createElement("div");
  section.id = SECTION_ID;
  section.className = classes.sectionWrapperClass;

  // Header wrapper (contains the "Time Tracking" label)
  const headerWrapper = document.createElement("div");
  headerWrapper.className = classes.headerWrapperClass;

  const headerSpan = document.createElement("span");
  headerSpan.className = classes.labelSpanClass;
  headerSpan.textContent = "Time Tracking";
  headerWrapper.appendChild(headerSpan);

  // Button outer container
  const buttonOuterContainer = document.createElement("div");
  buttonOuterContainer.className = classes.buttonOuterContainerClass;

  // Button wrapper with menu state
  const buttonWrapper = document.createElement("div");
  buttonWrapper.setAttribute("data-menu-open", "false");
  buttonWrapper.className = classes.buttonWrapperClass;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.tabIndex = 0;
  button.setAttribute("data-detail-button", "true");
  button.className = classes.buttonClass;

  // Play icon SVG
  const playIcon = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  playIcon.setAttribute("width", "16");
  playIcon.setAttribute("height", "16");
  playIcon.setAttribute("viewBox", "0 0 16 16");
  playIcon.setAttribute(
    "fill",
    isTracking ? "lch(66% 80 48)" : "lch(38.893% 1 282.863 / 1)",
  );
  playIcon.style.cssText = "flex-shrink: 0;";

  const playPath = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path",
  );
  if (isTracking) {
    // Stop icon (square)
    playPath.setAttribute(
      "d",
      "M4 3C3.44772 3 3 3.44772 3 4V12C3 12.5523 3.44772 13 4 13H12C12.5523 13 13 12.5523 13 12V4C13 3.44772 12.5523 3 12 3H4Z",
    );
  } else {
    // Play icon (triangle)
    playPath.setAttribute(
      "d",
      "M5 3.5C5 2.94772 5.44772 2.5 6 2.5C6.27614 2.5 6.5 2.72386 6.5 3V3.5L12.5 7.5C12.7761 7.77614 13 8.22386 13 8.5C13 9.05228 12.5523 9.5 12 9.5L6.5 13V13.5C6.5 13.7761 6.27614 14 6 14C5.44772 14 5 13.5523 5 13V3.5Z",
    );
  }
  playIcon.appendChild(playPath);

  const buttonText = document.createElement("span");
  buttonText.className = classes.buttonTextSpanClass;
  buttonText.textContent = isTracking ? "Stop Tracking" : "Start Tracking";

  button.appendChild(playIcon);
  button.appendChild(buttonText);

  // Assemble the DOM structure
  buttonWrapper.appendChild(button);
  buttonOuterContainer.appendChild(buttonWrapper);

  section.appendChild(headerWrapper);
  section.appendChild(buttonOuterContainer);

  return section;
}

/**
 * Injects the Time Tracking section into the sidebar
 */
export async function injectTimeTrackingSection(
  container: HTMLElement,
  issueDescription: string,
  skipExistingCheck = false,
): Promise<void> {
  // Check if section already exists and skip if so (unless explicitly told to replace)
  const existingSection = document.getElementById(SECTION_ID);
  if (existingSection && !skipExistingCheck) {
    return;
  }

  // Remove existing section if present
  if (existingSection) {
    existingSection.remove();
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

  // Create the section
  const section = createTimeTrackingSection(issueDescription, isTracking);

  // Find the Project section and insert after it
  const projectSection = Array.from(container.children).find((child) => {
    const labelText = child.querySelector("span")?.textContent;
    return labelText === "Project";
  });

  if (projectSection && projectSection.nextSibling) {
    // Insert after Project section
    container.insertBefore(section, projectSection.nextSibling);
  } else if (projectSection) {
    // Project is the last element, append after it
    container.appendChild(section);
  } else {
    // Fallback: if no Project section found, append at the end
    container.appendChild(section);
  }

  // Add click handler
  const button = document.getElementById(BUTTON_ID);
  if (button) {
    button.addEventListener("click", () =>
      handleTrackingClick(issueDescription, isTracking),
    );
  }
}

/**
 * Handles the Start/Stop Tracking button click
 */
async function handleTrackingClick(
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
      // Get the current organization and membership from storage
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

    // Refresh the section by finding the properties sidebar container
    const propertiesSidebar = findPropertiesSidebar();
    if (propertiesSidebar) {
      await injectTimeTrackingSection(
        propertiesSidebar,
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
 * Removes the Time Tracking section
 */
export function removeTimeTrackingSection(): void {
  const section = document.getElementById(SECTION_ID);
  if (section) {
    section.remove();
  }
}
