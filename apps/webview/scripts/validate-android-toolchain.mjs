import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED_ANDROID_JAVA_MAJOR = 21;

export function parseJavaMajor(output) {
  const match = output.match(/version\s+"(?:1\.)?(\d+)/);
  return match ? Number(match[1]) : null;
}

export function resolveJavaExecutable(env = process.env) {
  const javaHome = env.JAVA_HOME?.trim();
  if (!javaHome) return process.platform === "win32" ? "java.exe" : "java";
  return path.join(javaHome, "bin", process.platform === "win32" ? "java.exe" : "java");
}

export function detectJavaMajor(javaExecutable = resolveJavaExecutable()) {
  const result = spawnSync(javaExecutable, ["-version"], { encoding: "utf8" });
  if (result.error) throw result.error;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const major = parseJavaMajor(output);
  if (!major) throw new Error(`Unable to determine Java version from ${javaExecutable}`);
  return major;
}

export function validateAndroidToolchain({ javaExecutable = resolveJavaExecutable(), javaMajor = detectJavaMajor(javaExecutable) } = {}) {
  if (javaMajor !== REQUIRED_ANDROID_JAVA_MAJOR) {
    throw new Error(
      `Capacitor 8 Android modules require JDK ${REQUIRED_ANDROID_JAVA_MAJOR}; detected JDK ${javaMajor} at ${javaExecutable}`,
    );
  }
  return { javaExecutable, javaMajor };
}

function main() {
  try {
    const result = validateAndroidToolchain();
    process.stdout.write(`Android toolchain valid: JDK ${result.javaMajor} (${result.javaExecutable})\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown Android toolchain error";
    process.stderr.write(`Android toolchain invalid: ${message}\n`);
    process.exitCode = 1;
  }
}

const entrypoint = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entrypoint === path.resolve(fileURLToPath(import.meta.url))) main();
