import { beforeEach, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import { getCurrentTimeEntry } from "../entrypoints/utils/timeEntries";

const getMyActiveTimeEntry = vi.hoisted(() => vi.fn());
vi.mock("../entrypoints/utils/api", () => ({
  apiClient: () => ({ getMyActiveTimeEntry }),
}));

beforeEach(() => {
  getMyActiveTimeEntry.mockReset();
});

it("returns the running timer unchanged", async () => {
  const response = { data: { id: "running-timer" } };
  getMyActiveTimeEntry.mockResolvedValue(response);
  expect(await getCurrentTimeEntry()).toBe(response);
});

it("treats the server's no-active-timer response as an empty result", async () => {
  getMyActiveTimeEntry.mockRejectedValue(Object.assign(new AxiosError(), {
    response: { status: 404, data: { message: "No active time entry" } },
  }));
  await expect(getCurrentTimeEntry()).resolves.toEqual({ data: null });
});

it.each([
  [404, "Not Found"],
  [401, "Unauthenticated"],
  [500, "Server Error"],
])("preserves unexpected API errors (%s)", async (status, message) => {
  const error = Object.assign(new AxiosError(), {
    response: { status, data: { message } },
  });
  getMyActiveTimeEntry.mockRejectedValue(error);
  await expect(getCurrentTimeEntry()).rejects.toBe(error);
});

it("preserves network failures", async () => {
  const error = new AxiosError("Network Error");
  getMyActiveTimeEntry.mockRejectedValue(error);
  await expect(getCurrentTimeEntry()).rejects.toBe(error);
});
