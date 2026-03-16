import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";

export interface AutopilotConfig {
  executor: {
    maxParallel: number;
    timeoutMinutes: number;
    inactivityTimeoutMinutes: number;
    model: string;
  };
  planning: {
    model: string;
  };
  dashboard: {
    port: number;
  };
  sandbox: {
    enabled: boolean;
    autoAllowBash: boolean;
    networkRestricted: boolean;
    extraAllowedDomains: string[];
  };
}

const DEFAULTS: AutopilotConfig = {
  executor: {
    maxParallel: 5,
    timeoutMinutes: 60,
    inactivityTimeoutMinutes: 10,
    model: "sonnet",
  },
  planning: {
    model: "opus",
  },
  dashboard: {
    port: 3000,
  },
  sandbox: {
    enabled: true,
    autoAllowBash: true,
    networkRestricted: false,
    extraAllowedDomains: [],
  },
};

export function loadConfig(projectPath: string): AutopilotConfig {
  const configPath = resolve(projectPath, ".autopilot.yml");

  if (!existsSync(configPath)) {
    return { ...DEFAULTS };
  }

  const raw = readFileSync(configPath, "utf-8");
  const parsed = parseYaml(raw);
  if (!parsed || typeof parsed !== "object") return { ...DEFAULTS };

  return mergeConfig(DEFAULTS, parsed as Partial<AutopilotConfig>);
}

function mergeConfig(
  defaults: AutopilotConfig,
  overrides: Partial<AutopilotConfig>,
): AutopilotConfig {
  return {
    executor: { ...defaults.executor, ...overrides.executor },
    planning: { ...defaults.planning, ...overrides.planning },
    dashboard: { ...defaults.dashboard, ...overrides.dashboard },
    sandbox: { ...defaults.sandbox, ...overrides.sandbox },
  };
}
