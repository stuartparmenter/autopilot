import { describe, expect, test } from "bun:test";
import { interruptibleSleep } from "./errors";

describe("interruptibleSleep", () => {
  test("pre-aborted signal resolves immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    await interruptibleSleep(5000, controller.signal);
    expect(Date.now() - start).toBeLessThan(50);
  });

  test("abort during sleep resolves early", async () => {
    const controller = new AbortController();
    const start = Date.now();
    const sleepPromise = interruptibleSleep(5000, controller.signal);
    // Abort after a short delay
    setTimeout(() => controller.abort(), 20);
    await sleepPromise;
    expect(Date.now() - start).toBeLessThan(200);
  });

  test("full duration sleep when not aborted", async () => {
    const controller = new AbortController();
    const start = Date.now();
    await interruptibleSleep(50, controller.signal);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });
});
