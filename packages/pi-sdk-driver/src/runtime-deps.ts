import { join, resolve } from "node:path";
import { ModelRuntime, getAgentDir } from "@earendil-works/pi-coding-agent";
import { CustomProviderStore } from "./custom-provider-store.js";
import type { RuntimeSupervisorOptions } from "./runtime-supervisor.js";

export interface RuntimeDependencies {
  readonly agentDir: string;
  readonly modelRuntime: Promise<ModelRuntime>;
  readonly customProviderStore: CustomProviderStore;
}

export function createRuntimeDependencies(options: RuntimeSupervisorOptions = {}): RuntimeDependencies {
  const agentDir = resolve(options.agentDir ?? getAgentDir());
  const modelsJsonPath = join(agentDir, "models.json");
  const modelRuntime = options.modelRuntime
    ? Promise.resolve(options.modelRuntime)
    : ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: modelsJsonPath,
      });
  const customProviderStore = options.customProviderStore ?? new CustomProviderStore(modelsJsonPath);
  return {
    agentDir,
    modelRuntime,
    customProviderStore,
  };
}
