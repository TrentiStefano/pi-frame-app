import crossSpawn from "cross-spawn";

/**
 * Spawn a child without routing argv through a shell. cross-spawn resolves
 * Windows command shims while preserving arguments verbatim.
 */
export function spawnProcess(command, args, options) {
  return crossSpawn(command, args, options);
}

export function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} exited with ${signal ?? code}`));
    });
  });
}

export function start(command, args, cwd) {
  return spawnProcess(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}
