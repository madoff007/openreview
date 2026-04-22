import { Sandbox } from "@vercel/sandbox";

import { parseError } from "@/lib/error";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
const THREE_MINUTES_MS = 3 * 60 * 1000;

const detectInstallCommand = async (
  sandbox: Sandbox
): Promise<{ args: string[]; cmd: string }> => {
  const checks = [
    {
      args: ["install", "--frozen-lockfile"],
      cmd: "bun",
      lockfile: "bun.lock",
    },
    {
      args: ["install", "--frozen-lockfile"],
      cmd: "pnpm",
      lockfile: "pnpm-lock.yaml",
    },
    {
      args: ["install", "--frozen-lockfile"],
      cmd: "yarn",
      lockfile: "yarn.lock",
    },
  ];

  for (const { args, cmd, lockfile } of checks) {
    const result = await sandbox.runCommand("test", ["-f", lockfile]);
    if (result.exitCode === 0) {
      return { args, cmd };
    }
  }

  return { args: ["install"], cmd: "npm" };
};

const installGitHubCli = async (sandbox: Sandbox): Promise<void> => {
  const ghInstall = await sandbox.runCommand("bash", [
    "-c",
    "command -v gh >/dev/null 2>&1 || (" +
      "curl -sLO https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_linux_amd64.tar.gz &&" +
      " tar xzf gh_2.62.0_linux_amd64.tar.gz &&" +
      " mkdir -p ~/.local/bin &&" +
      " cp -f gh_2.62.0_linux_amd64/bin/gh ~/.local/bin/ &&" +
      " rm -rf gh_2.62.0_linux_amd64*)",
  ]);

  if (ghInstall.exitCode === 0) {
    return;
  }

  const stderr = await ghInstall.stderr();
  const stdout = await ghInstall.stdout();
  throw new Error(
    `Failed to install GitHub CLI (exit ${ghInstall.exitCode}): ${stderr || stdout}`
  );
};

const installProjectDependencies = async (sandbox: Sandbox): Promise<void> => {
  const { cmd, args } = await detectInstallCommand(sandbox);

  if (cmd !== "npm") {
    await sandbox.runCommand("npm", ["install", "-g", cmd]);
  }

  const installResult = await sandbox.runCommand(cmd, args);

  if (installResult.exitCode === 0) {
    return;
  }

  const stderr = await installResult.stderr();
  const stdout = await installResult.stdout();
  throw new Error(
    `Failed to install project dependencies (exit ${installResult.exitCode}): ${stderr || stdout}`
  );
};

const configureRemoteAndIdentity = async (
  sandbox: Sandbox,
  authenticatedUrl: string,
  token: string
): Promise<void> => {
  await sandbox.runCommand("git", [
    "remote",
    "set-url",
    "origin",
    authenticatedUrl,
  ]);

  await sandbox.runCommand("git", [
    "config",
    "--local",
    "core.hooksPath",
    "/dev/null",
  ]);

  await sandbox.runCommand("git", ["config", "user.name", "openreview[bot]"]);

  await sandbox.runCommand("git", [
    "config",
    "user.email",
    "openreview[bot]@users.noreply.github.com",
  ]);

  await sandbox.runCommand("bash", [
    "-c",
    `export PATH="$HOME/.local/bin:$PATH" && echo "${token}" | gh auth login --with-token`,
  ]);
};

export const prepareSandbox = async (
  repoFullName: string,
  token: string,
  branch: string
): Promise<string> => {
  "use step";

  try {
    console.log("[prepareSandbox] creating sandbox");
    const sandbox = await Sandbox.create({
      source: {
        depth: 1,
        password: token,
        revision: branch,
        type: "git",
        url: `https://github.com/${repoFullName}.git`,
        username: "x-access-token",
      },
      timeout: FIVE_MINUTES_MS,
    });

    console.log("[prepareSandbox] installing GitHub CLI");
    await installGitHubCli(sandbox);

    console.log("[prepareSandbox] installing project dependencies");
    await installProjectDependencies(sandbox);

    console.log("[prepareSandbox] configuring git");
    await configureRemoteAndIdentity(
      sandbox,
      `https://x-access-token:${token}@github.com/${repoFullName}.git`,
      token
    );

    console.log("[prepareSandbox] extending sandbox timeout");
    await sandbox.extendTimeout(THREE_MINUTES_MS);

    return sandbox.sandboxId;
  } catch (error) {
    throw new Error(`Failed to prepare sandbox: ${parseError(error)}`, {
      cause: error,
    });
  }
};
