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
  const parsed = parseYaml(raw) ?? {};

  return deepMerge(DEFAULTS, parsed) as AutopilotConfig;
}

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === "object"
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}
