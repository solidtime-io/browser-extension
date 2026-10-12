// @vitest-environment happy-dom
// @vitest-environment-options {"url":"https://github.com/"}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContentScriptContext } from "wxt/utils/content-script-context";
import { accessToken } from "../entrypoints/utils/oauth";
import { getGitHubIssueInfo, initializeGitHub } from "../entrypoints/utils/github";

const api = vi.hoisted(() => ({
  current: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  storage: vi.fn(),
}));
vi.mock("../entrypoints/utils/api", () => ({
  apiClient: () => ({ createTimeEntry: api.create, updateTimeEntry: api.update }),
}));
vi.mock("../entrypoints/utils/timeEntries", () => ({ getCurrentTimeEntry: api.current }));
vi.mock("../entrypoints/utils/oauth", async () => ({
  accessToken: (await import("vue")).ref("token"),
}));

const button = () => document.querySelector<HTMLButtonElement>("#solidtime-github-tracking-btn");
let dispose: () => void;

function showIssue(number = 3, title = "GitHub support") {
  history.replaceState(null, "", `/solidtime-io/browser-extension/issues/${number}`);
  document.body.innerHTML = `
    <div data-component="TitleArea"><h1><bdi data-testid="issue-title"></bdi><span>#${number}</span></h1></div>
    <aside>
      <div data-testid="sidebar-assignees-section">
        <h3>Assignees</h3>
        <div><button>Assign to Agent</button></div>
      </div>
      <div data-testid="sidebar-labels-section"><h3>Labels</h3></div>
    </aside>`;
  document.querySelector("bdi")!.textContent = title;
}

function showProject(ownerType = "orgs", number = 3) {
  history.replaceState(null, "", `/${ownerType}/solidtime-io/projects/1/views/2?pane=issue&itemId=123&issue=solidtime-io%7Cbrowser-extension%7C${number}`);
  document.body.innerHTML = `
    <h1>Project board</h1>
    <a href="/another/repo/issues/1">Another card</a>
    <div role="dialog"><div data-component="TitleArea"><h1>
      <bdi data-testid="issue-title">Selected project issue</bdi>
      <span><a href="/solidtime-io/browser-extension/issues/${number}">#${number}</a></span>
    </h1></div></div>`;
}

function initialize() {
  const cleanups: (() => void)[] = [];
  const ctx = {
    isValid: true,
    isInvalid: false,
    onInvalidated: (callback: () => void) => cleanups.push(callback),
    addEventListener: (target: EventTarget, event: string, callback: EventListener) => {
      target.addEventListener(event, callback);
      cleanups.push(() => target.removeEventListener(event, callback));
    },
  };
  dispose = () => {
    ctx.isValid = false;
    ctx.isInvalid = true;
    cleanups.forEach((cleanup) => cleanup());
  };
  initializeGitHub(ctx as unknown as ContentScriptContext);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.current.mockResolvedValue({ data: null });
  api.storage.mockResolvedValue({ current_organization_id: "org", currentMembershipId: "member" });
  api.create.mockResolvedValue({});
  api.update.mockResolvedValue({});
  accessToken.value = "token";
  vi.stubGlobal("browser", { storage: { local: { get: api.storage } } });
  vi.stubGlobal("alert", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
  dispose = () => {};
  showIssue();
});

afterEach(() => {
  dispose();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GitHub issue context", () => {
  it("reads the repository, issue number and formatted title", () => {
    history.replaceState(null, "", "/solidtime-io/browser-extension/issues/3?foo=bar#issuecomment-123");
    document.querySelector("bdi")!.innerHTML = "Fix <code>&lt;script&gt;</code> &amp; titles";
    expect(getGitHubIssueInfo()).toMatchObject({
      description: "solidtime-io/browser-extension#3 Fix <script> & titles",
    });
  });

  it("supports the legacy repository title", () => {
    document.body.innerHTML = '<h1><span class="js-issue-title">Legacy title</span><span>#3</span></h1>';
    expect(getGitHubIssueInfo()?.description).toBe("solidtime-io/browser-extension#3 Legacy title");
  });

  it.each(["/org/repo", "/org/repo/issues", "/org/repo/issues/new", "/org/repo/issues/3/edit", "/org/repo/pull/3"])("ignores %s", (path) => {
    history.replaceState(null, "", path);
    expect(getGitHubIssueInfo()).toBeNull();
  });

  it.each(["orgs", "users"])("reads only the selected issue in %s Projects", (ownerType) => {
    showProject(ownerType);
    expect(getGitHubIssueInfo()).toMatchObject({
      description: "solidtime-io/browser-extension#3 Selected project issue",
    });
  });

  it("ignores closed project panes, drafts, and stale issue content", () => {
    showProject();
    history.replaceState(null, "", "/orgs/solidtime-io/projects/1?pane=issue&issue=solidtime-io%7Cbrowser-extension%7C4");
    expect(getGitHubIssueInfo()).toBeNull();
    history.replaceState(null, "", "/orgs/solidtime-io/projects/1");
    expect(getGitHubIssueInfo()).toBeNull();
    history.replaceState(null, "", "/orgs/solidtime-io/projects/1?pane=issue&itemId=123");
    document.querySelector('h1 a')!.remove();
    expect(getGitHubIssueInfo()).toBeNull();
  });

  it("ignores a stale heading even when its title mentions the requested issue number", () => {
    showIssue(30);
    history.replaceState(null, "", "/solidtime-io/browser-extension/issues/3");
    document.querySelector("bdi")!.innerHTML = 'Follow up on <span>#3</span>';
    expect(getGitHubIssueInfo()).toBeNull();
  });

  it("rejects a project issue link to another site", () => {
    showProject();
    document.querySelector('h1 a')!.setAttribute("href", "https://example.com/solidtime-io/browser-extension/issues/3");
    expect(getGitHubIssueInfo()).toBeNull();
  });

  it("ignores malformed project issue links", () => {
    showProject();
    document.querySelector('h1 a')!.setAttribute("href", "https://[/issues/3");
    expect(getGitHubIssueInfo()).toBeNull();
  });
});

describe("GitHub time tracking", () => {
  it("places tracking below Assign to Agent in the Assignees sidebar", () => {
    initialize();
    const assignees = document.querySelector('[data-testid="sidebar-assignees-section"]')!;
    expect(assignees.lastElementChild).toBe(button());
    expect(button()!.previousElementSibling?.textContent).toBe("Assign to Agent");
    expect(document.querySelector('[data-component="TitleArea"] button')).toBeNull();
  });

  it("uses the Assignees section even without Assign to Agent", () => {
    const assignees = document.querySelector('[data-testid="sidebar-assignees-section"]')!;
    assignees.querySelector("button")!.remove();
    initialize();
    expect(assignees.lastElementChild).toBe(button());
  });

  it("moves the same button into a late sidebar and restores it after a sidebar rerender", async () => {
    const assignees = document.querySelector('[data-testid="sidebar-assignees-section"]')!;
    assignees.remove();
    initialize();
    const original = button()!;
    expect(original.previousElementSibling).toBe(document.querySelector("h1"));

    document.querySelector("aside")!.prepend(assignees);
    await vi.waitFor(() => expect(assignees.lastElementChild).toBe(original));
    assignees.innerHTML = "<h3>Assignees</h3>";
    await vi.waitFor(() => expect(assignees.lastElementChild).toBe(original));
    expect(document.querySelectorAll("#solidtime-github-tracking-btn")).toHaveLength(1);
  });

  it("keeps Projects tracking in the selected issue pane", async () => {
    showProject();
    document.body.insertAdjacentHTML("afterbegin", '<div data-testid="sidebar-assignees-section">Board sidebar</div>');
    initialize();
    const original = button()!;
    expect(original.closest('[role="dialog"]')).not.toBeNull();

    const dialog = document.querySelector('[role="dialog"]')!;
    dialog.insertAdjacentHTML("beforeend", '<div data-testid="sidebar-assignees-section"><h3>Assignees</h3></div>');
    await vi.waitFor(() => expect(original.parentElement).toBe(dialog.lastElementChild));
  });

  it.each(["token", ""])("shows Start Tracking with an edit tooltip and token %j", (token) => {
    accessToken.value = token;
    showIssue(4194, "Support Ionic v9 breaking changes");
    document.querySelector("h1 > span")!.innerHTML = `
      <span>&nbsp;#4194</span>
      <button aria-label="Edit issue title"></button>
      <span role="tooltip" aria-hidden="true">Edit issue title</span>`;
    initialize();

    expect(button()?.textContent).toBe("Start Tracking");
  });

  it("creates an entry with issue context and prevents duplicate clicks", async () => {
    initialize();
    button()!.click();
    button()!.click();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledOnce());
    expect(api.create).toHaveBeenCalledWith({
      member_id: "member",
      description: "solidtime-io/browser-extension#3 GitHub support",
      start: expect.any(String),
      billable: false,
    }, { params: { organization: "org" } });
    expect(Number.isNaN(Date.parse(api.create.mock.calls[0][0].start))).toBe(false);
    expect(button()!.textContent).toBe("Stop Tracking");
    expect(button()!.disabled).toBe(false);
  });

  it("stops the current entry in its own organization after an external timer change", async () => {
    initialize();
    await vi.waitFor(() => expect(button()!.textContent).toBe("Start Tracking"));
    const current = { id: "entry", organization_id: "another-org", description: "Other work", billable: true };
    api.current.mockResolvedValue({ data: current });
    button()!.click();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    expect(api.update).toHaveBeenCalledWith({ ...current, end: expect.any(String) }, {
      params: { organization: "another-org", timeEntry: "entry" },
    });
    expect(api.create).not.toHaveBeenCalled();
    expect(button()!.textContent).toBe("Start Tracking");
  });

  it("refreshes when login arrives or the tab regains focus", async () => {
    accessToken.value = "";
    initialize();
    expect(api.current).not.toHaveBeenCalled();
    api.current.mockResolvedValue({ data: { id: "entry" } });
    accessToken.value = "token";
    await vi.waitFor(() => expect(button()!.textContent).toBe("Stop Tracking"));
    api.current.mockResolvedValue({ data: null });
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(button()!.textContent).toBe("Start Tracking"));
  });

  it("requires login and valid organization selection", async () => {
    accessToken.value = "";
    initialize();
    button()!.click();
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("log in"));
    expect(api.current).not.toHaveBeenCalled();
    accessToken.value = "token";
    api.storage.mockResolvedValue({ current_organization_id: {}, currentMembershipId: "member" });
    button()!.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("select an organization")));
    expect(api.create).not.toHaveBeenCalled();
    expect(button()!.disabled).toBe(false);
  });

  it.each(["current", "create", "update"] as const)("recovers from a failed %s request", async (operation) => {
    if (operation === "update") api.current.mockResolvedValue({ data: { id: "entry", organization_id: "org" } });
    initialize();
    await Promise.resolve();
    api[operation].mockRejectedValue(new Error("Network error"));
    button()!.click();
    await vi.waitFor(() => expect(alert).toHaveBeenCalledWith(expect.stringContaining("Failed to toggle")));
    expect(button()!.disabled).toBe(false);
    if (operation === "current") expect(api.create).not.toHaveBeenCalled();
  });

  it("reinjects once after rerenders and removes the button on navigation", async () => {
    initialize();
    showIssue(4, "Next issue");
    await vi.waitFor(() => expect(button()).not.toBeNull());
    button()!.click();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      description: "solidtime-io/browser-extension#4 Next issue",
    }), expect.anything()));
    document.body.appendChild(document.createElement("div"));
    await new Promise(requestAnimationFrame);
    expect(document.querySelectorAll("#solidtime-github-tracking-btn")).toHaveLength(1);
    history.replaceState(null, "", "/solidtime-io/browser-extension/issues");
    window.dispatchEvent(new Event("wxt:locationchange"));
    await vi.waitFor(() => expect(button()).toBeNull());
  });

  it("tracks the current Projects issue when a pane reuses its heading", async () => {
    showProject();
    initialize();
    history.replaceState(null, "", "/orgs/solidtime-io/projects/1?pane=issue&issue=solidtime-io%7Cbrowser-extension%7C4");
    const link = document.querySelector('h1 a')!;
    link.setAttribute("href", "/solidtime-io/browser-extension/issues/4");
    link.textContent = "#4";
    document.querySelector("bdi")!.textContent = "Another project issue";
    button()!.click();
    await vi.waitFor(() => expect(api.create).toHaveBeenCalledWith(expect.objectContaining({
      description: "solidtime-io/browser-extension#4 Another project issue",
    }), expect.anything()));
  });

  it("preserves the button and keyboard focus when the title changes", async () => {
    initialize();
    const original = button()!;
    original.focus();
    document.querySelector("bdi")!.textContent = "Renamed issue";
    await vi.waitFor(() => expect(button()!.title).toContain("Renamed issue"));
    expect(button()).toBe(original);
    expect(document.activeElement).toBe(original);
  });

  it("keeps the running state across navigation when stopping fails", async () => {
    api.current.mockResolvedValue({ data: { id: "entry", organization_id: "org" } });
    let rejectStop!: (error: Error) => void;
    api.update.mockReturnValue(new Promise((_, reject) => { rejectStop = reject; }));
    initialize();
    await vi.waitFor(() => expect(button()!.textContent).toBe("Stop Tracking"));
    button()!.click();
    await vi.waitFor(() => expect(api.update).toHaveBeenCalledOnce());
    showIssue(4);
    await vi.waitFor(() => expect(button()).not.toBeNull());
    expect(button()!.disabled).toBe(true);
    rejectStop(new Error("Network error"));
    await vi.waitFor(() => expect(button()!.disabled).toBe(false));
    expect(button()!.textContent).toBe("Stop Tracking");
  });

  it("does not let a delayed initial fetch overwrite a completed start", async () => {
    let resolveInitial!: (value: { data: null }) => void;
    api.current.mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }));
    initialize();
    button()!.click();
    await vi.waitFor(() => expect(button()!.textContent).toBe("Stop Tracking"));
    resolveInitial({ data: null });
    await Promise.resolve();
    expect(button()!.textContent).toBe("Stop Tracking");
  });

  it("cleans up observers and pending requests on invalidation", async () => {
    let resolveInitial!: (value: { data: { id: string } }) => void;
    api.current.mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }));
    initialize();
    dispose();
    resolveInitial({ data: { id: "entry" } });
    showIssue(4);
    window.dispatchEvent(new Event("focus"));
    await new Promise(requestAnimationFrame);
    expect(button()).toBeNull();
    expect(api.current).toHaveBeenCalledOnce();
  });

  it.each(["current", "storage"] as const)("does not create an entry after invalidation during %s lookup", async (operation) => {
    initialize();
    let finishLookup!: () => void;
    api[operation].mockReturnValueOnce(new Promise((resolve) => {
      finishLookup = () => resolve(operation === "current"
        ? { data: null }
        : { current_organization_id: "org", currentMembershipId: "member" });
    }));
    button()!.click();
    await vi.waitFor(() => expect(operation === "current" ? api.current : api.storage).toHaveBeenCalled());
    dispose();
    finishLookup();
    await new Promise(requestAnimationFrame);
    expect(api.create).not.toHaveBeenCalled();
    expect(api.update).not.toHaveBeenCalled();
    expect(button()).toBeNull();
  });
});
