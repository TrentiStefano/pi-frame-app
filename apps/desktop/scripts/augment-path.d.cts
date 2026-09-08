export interface AugmentMacPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  delimiter?: string;
}

export interface AugmentedPath {
  changed: boolean;
  path: string;
}

export function augmentMacPath(options?: AugmentMacPathOptions): AugmentedPath;
