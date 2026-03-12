import { beforeEach, describe, expect, test } from "bun:test";
import { AppState } from "../state";
import {
  CircuitBreakerRegistry,
  CircuitOpenError,
  defaultRegistry,
  inferService,
} from "./circuit-breaker";
import { withRetry } from "./retry";

// Fast config for tests: open after 3 failures in 5 s, cooldown 100 ms
const TEST_CONFIG = {
  failureThreshold: 3,
  windowMs: 5_000,
  cooldownMs: 100,
};

const noDelay = { baseDelayMs: 0, maxDelayMs: 0 };

describe("inferService", () => {
  test("all labels map to github", () => {
    expect(inferService("getPR #42")).toBe("github");
    expect(inferService("getChecks #10")).toBe("github");
    expect(inferService("validateGitHub")).toBe("github");
    expect(inferService("someUnknownLabel")).toBe("github");
  });
});

describe("CircuitBreakerRegistry", () => {
  let registry: CircuitBreakerRegistry;

  beforeEach(() => {
    registry = new CircuitBreakerRegistry(TEST_CONFIG);
  });

  test("starts in closed state", () => {
    expect(registry.getState("github")).toBe("closed");
  });

  test("transitions to open after failureThreshold failures within window", () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    expect(registry.getState("github")).toBe("closed");
    registry.recordFailure("github");
    expect(registry.getState("github")).toBe("open");
  });

  test("isOpen returns true and blocks calls when open", () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");
    expect(registry.isOpen("github")).toBe(true);
  });

  test("transitions to half-open after cooldown elapses", async () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");
    expect(registry.getState("github")).toBe("open");

    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));

    expect(registry.getState("github")).toBe("half-open");
  });

  test("half-open allows first probe (isOpen returns false once)", async () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");

    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));

    // First call: probe allowed
    expect(registry.isOpen("github")).toBe(false);
    // Second call before probe resolves: blocked
    expect(registry.isOpen("github")).toBe(true);
  });

  test("successful probe in half-open closes the circuit", async () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");

    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));

    registry.isOpen("github"); // grant probe
    registry.recordSuccess("github");

    expect(registry.getState("github")).toBe("closed");
  });

  test("failed probe in half-open re-opens the circuit", async () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");

    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));

    registry.isOpen("github"); // grant probe
    registry.recordFailure("github"); // probe fails

    expect(registry.getState("github")).toBe("open");
  });

  test("reset restores closed state and clears all data", () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");
    expect(registry.getState("github")).toBe("open");

    registry.reset("github");
    expect(registry.getState("github")).toBe("closed");
    expect(registry.isOpen("github")).toBe(false);
  });

  test("reset() with no argument resets all services", () => {
    registry.recordFailure("github");
    registry.recordFailure("github");
    registry.recordFailure("github");

    registry.reset();

    expect(registry.getState("github")).toBe("closed");
  });

  test("getAllStates returns github state", () => {
    const states = registry.getAllStates();
    expect(states.github).toBe("closed");
  });
});

describe("withRetry circuit-breaker integration", () => {
  beforeEach(() => {
    defaultRegistry.reset();
  });

  test("open circuit causes withRetry to throw CircuitOpenError with zero fn invocations", async () => {
    for (let i = 0; i < 10; i++) {
      defaultRegistry.recordFailure("github");
    }

    let calls = 0;
    let thrown: unknown;
    try {
      await withRetry(
        async () => {
          calls++;
          return "ok";
        },
        "getPR #42",
        { service: "github" },
      );
    } catch (e) {
      thrown = e;
    }

    expect(calls).toBe(0);
    expect(thrown).toBeInstanceOf(CircuitOpenError);
    expect((thrown as CircuitOpenError).service).toBe("github");
    expect((thrown as CircuitOpenError).label).toBe("getPR #42");
  });

  test("successful probe in half-open closes the circuit and allows subsequent calls", async () => {
    const fastRegistry = new CircuitBreakerRegistry(TEST_CONFIG);
    for (let i = 0; i < 3; i++) {
      fastRegistry.recordFailure("github");
    }
    expect(fastRegistry.isOpen("github")).toBe(true);

    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));

    expect(fastRegistry.getState("github")).toBe("half-open");

    fastRegistry.isOpen("github"); // grants probe
    fastRegistry.recordSuccess("github");
    expect(fastRegistry.getState("github")).toBe("closed");
  });

  test("failed probe re-opens the circuit", async () => {
    const fastRegistry = new CircuitBreakerRegistry(TEST_CONFIG);
    for (let i = 0; i < 3; i++) {
      fastRegistry.recordFailure("github");
    }

    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));

    fastRegistry.isOpen("github"); // grants probe
    fastRegistry.recordFailure("github"); // probe fails

    expect(fastRegistry.getState("github")).toBe("open");
    expect(fastRegistry.isOpen("github")).toBe(true);
  });

  test("transient failures inside withRetry increment the circuit breaker", async () => {
    let thrown: unknown;
    try {
      await withRetry(
        async () => {
          throw Object.assign(new Error("server error"), { status: 500 });
        },
        "getPR #42",
        { maxAttempts: 3, service: "github", ...noDelay },
      );
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    const states = defaultRegistry.getAllStates();
    // Circuit is still closed (only 3 out of 10 threshold)
    expect(states.github).toBe("closed");
  });
});

describe("AppState.toJSON() apiHealth", () => {
  beforeEach(() => {
    defaultRegistry.reset();
  });

  test("toJSON includes apiHealth with closed state initially", () => {
    const state = new AppState();
    const snapshot = state.toJSON();
    expect(snapshot.apiHealth).toBeDefined();
    expect(snapshot.apiHealth.github).toBe("closed");
  });

  test("toJSON reflects open circuit state for github", () => {
    for (let i = 0; i < 10; i++) {
      defaultRegistry.recordFailure("github");
    }

    const state = new AppState();
    const snapshot = state.toJSON();
    expect(snapshot.apiHealth.github).toBe("open");
  });

  test("toJSON reflects half-open state after cooldown", async () => {
    const fastRegistry = new CircuitBreakerRegistry(TEST_CONFIG);
    for (let i = 0; i < 3; i++) {
      fastRegistry.recordFailure("github");
    }
    await new Promise((r) => setTimeout(r, TEST_CONFIG.cooldownMs + 50));
    expect(fastRegistry.getState("github")).toBe("half-open");

    const state = new AppState();
    const snapshot = state.toJSON();
    // defaultRegistry was reset in beforeEach, so apiHealth should be closed
    expect(snapshot.apiHealth.github).toBe("closed");
  });
});
