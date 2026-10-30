import { beforeEach, expect, test } from "bun:test";
import { flushHourly, notify, resetNotifications } from "../src/messaging/notifications.js";

beforeEach(resetNotifications);

test("an hourly flush groups the queued notifications by user", () => {
  notify(1, "a");
  notify(2, "b");
  notify(1, "c");
  expect(flushHourly()).toEqual([
    { userId: 1, texts: ["a", "c"] },
    { userId: 2, texts: ["b"] },
  ]);
  expect(flushHourly()).toEqual([]);
});
