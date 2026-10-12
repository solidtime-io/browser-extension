import type { CreateTimeEntryBody } from "@solidtime/api";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { watch } from "vue";
import { apiClient } from "./api";
import { dayjs } from "./dayjs";
import { accessToken } from "./oauth";
import { getCurrentTimeEntry } from "./timeEntries";

const BUTTON_ID = "solidtime-github-tracking-btn";
const ISSUE_PATH = /^\/([^/]+)\/([^/]+)\/issues\/([1-9]\d*)\/?$/;
const PROJECT_PATH = /^\/(?:orgs|users)\/[^/]+\/projects\/\d+(?:\/views\/\d+)?\/?$/;

export function getGitHubIssueInfo() {
  const url = new URL(window.location.href);
  if (url.hostname !== "github.com") return null;

  const isProject = PROJECT_PATH.test(url.pathname);
  if (!isProject && !ISSUE_PATH.test(url.pathname)) return null;

  const title = document.querySelector<HTMLElement>(
    isProject
      ? '[role="dialog"] h1 [data-testid="issue-title"]'
      : 'h1 [data-testid="issue-title"], h1 .js-issue-title',
  );
  const heading = title?.closest("h1");
  const issueTitle = title?.textContent?.trim();
  if (!heading || !issueTitle) return null;

  // Projects keep their own URL; the issue number links to the selected issue.
  const issueUrl = isProject
    ? heading.querySelector<HTMLAnchorElement>('a[href*="/issues/"]')
    : url;
  const match = issueUrl?.pathname.match(ISSUE_PATH);
  if (!match || issueUrl?.origin !== url.origin) return null;

  const [, owner, repository, number] = match;
  // The heading can also contain an edit button's tooltip after the issue number.
  const hasIssueNumber = Array.from(heading.querySelectorAll("span, a")).some(
    (element) => !title?.contains(element) && element.textContent?.trim() === `#${number}`,
  );
  if (!hasIssueNumber) return null;
  if (isProject) {
    const selectedIssue = url.searchParams.get("issue");
    if (
      url.searchParams.get("pane") !== "issue" ||
      (selectedIssue && selectedIssue !== `${owner}|${repository}|${number}`)
    ) {
      return null;
    }
  }

  return {
    description: `${owner}/${repository}#${number} ${issueTitle}`,
    heading,
  };
}

export function initializeGitHub(ctx: ContentScriptContext): void {
  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.className = "btn btn-sm mt-2";
  button.addEventListener("click", handleClick);

  let description = "";
  let isTracking = false;
  let pending = false;
  let frame: number | null = null;
  let refreshVersion = 0;

  function renderButton() {
    const tracking = !!accessToken.value && isTracking;
    const label = tracking ? "Stop Tracking" : "Start Tracking";
    if (button.textContent !== label) button.textContent = label;
    button.setAttribute("aria-label", `${label} in Solidtime`);
    button.title = tracking ? "Stop the current Solidtime timer" : description;
    button.disabled = pending;
  }

  async function refreshTracking() {
    const version = ++refreshVersion;
    if (!button.isConnected || pending) return;
    try {
      const entry = accessToken.value ? await getCurrentTimeEntry() : null;
      if (ctx.isValid && version === refreshVersion && !pending) {
        isTracking = !!entry?.data?.id;
        renderButton();
      }
    } catch (error) {
      console.error("Solidtime: Failed to get current time entry:", error);
    }
  }

  async function handleClick(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (pending || ctx.isInvalid) return;
    // Read the current DOM again so a reused Projects pane cannot track the previous issue.
    const issue = getGitHubIssueInfo();
    if (!issue) return;
    pending = true;
    refreshVersion++;
    renderButton();

    try {
      if (!accessToken.value) {
        alert("Please log in to Solidtime first by clicking the extension icon");
        return;
      }

      // Fetch on click as the timer may have changed in the popup or another tab.
      const currentEntry = await getCurrentTimeEntry();
      if (ctx.isInvalid) return;
      const client = apiClient();
      isTracking = !!currentEntry?.data?.id;
      if (currentEntry?.data?.id) {
        await client.updateTimeEntry(
          { ...currentEntry.data, end: dayjs.utc().format() },
          {
            params: {
              organization: currentEntry.data.organization_id,
              timeEntry: currentEntry.data.id,
            },
          },
        );
        isTracking = false;
      } else {
        const storage = await browser.storage.local.get([
          "current_organization_id",
          "currentMembershipId",
        ]);
        if (ctx.isInvalid) return;
        const organizationId = storage.current_organization_id;
        const membershipId = storage.currentMembershipId;
        if (
          typeof organizationId !== "string" || !organizationId ||
          typeof membershipId !== "string" || !membershipId
        ) {
          alert("Please select an organization in the Solidtime extension first");
          return;
        }

        const timeEntry: CreateTimeEntryBody = {
          member_id: membershipId,
          description: issue.description,
          start: dayjs.utc().format(),
          billable: false,
        };
        await client.createTimeEntry(timeEntry, {
          params: { organization: organizationId },
        });
        isTracking = true;
      }
    } catch (error) {
      console.error("Solidtime: Failed to toggle time tracking:", error);
      if (ctx.isValid) {
        alert("Failed to toggle time tracking. Please make sure you are logged in.");
      }
    } finally {
      pending = false;
      if (ctx.isValid) renderButton();
    }
  }

  function syncButton() {
    frame = null;
    if (ctx.isInvalid) return;
    const issue = getGitHubIssueInfo();
    if (!issue) {
      button.remove();
      description = "";
      refreshVersion++;
      return;
    }

    const scope = issue.heading.closest('[role="dialog"]') || document;
    const assignees = scope.querySelector('[data-testid="sidebar-assignees-section"]');
    const inPosition = assignees
      ? button.parentElement === assignees && assignees.lastElementChild === button
      : button.previousElementSibling === issue.heading;
    if (inPosition && description === issue.description) return;

    description = issue.description;
    button.classList.toggle("mx-2", !!assignees);
    button.style.width = assignees ? "calc(100% - 16px)" : "";
    if (!inPosition) {
      if (assignees) assignees.append(button);
      else issue.heading.after(button);
    }
    renderButton();
    void refreshTracking();
  }

  function scheduleSync() {
    if (frame === null && ctx.isValid) {
      // WXT retains an invalidation listener per frame; keep just one cleanup below.
      frame = requestAnimationFrame(syncButton);
    }
  }

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  ctx.addEventListener(window, "wxt:locationchange", scheduleSync);
  ctx.addEventListener(window, "focus", refreshTracking);
  const unwatch = watch(accessToken, refreshTracking);
  ctx.onInvalidated(() => {
    observer.disconnect();
    unwatch();
    if (frame !== null) cancelAnimationFrame(frame);
    button.remove();
  });
  syncButton();
}
