/** Standard build entry point. Production verification must succeed before Next runs. */
import { spawn as spawnChild } from 'node:child_process';
import { constants } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Contains only fixed step names and exit metadata, never child errors or environment values. */
export class DeploymentBuildError extends Error {
  constructor(step, { exitCode = null, signal = null, spawnFailed = false } = {}) {
    super(`${step} ${spawnFailed ? 'could not start' : signal ? 'was terminated' : 'failed'}. Next steps were not run.`);
    this.name = 'DeploymentBuildError';
    this.step = step;
    this.signal = signal;
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0 && exitCode <= 255
      ? exitCode : signal && constants.signals[signal] ? 128 + constants.signals[signal] : 1;
  }
}

function runStep(step, args, { spawn, node, cwd, env }) {
  return new Promise((fulfill, reject) => {
    let child;
    try {
      child = spawn(node, args, { cwd, env, stdio: 'inherit', shell: false });
    } catch {
      reject(new DeploymentBuildError(step, { spawnFailed: true }));
      return;
    }
    child.once('error', () => reject(new DeploymentBuildError(step, { spawnFailed: true })));
    child.once('close', (exitCode, signal) => {
      if (exitCode === 0 && !signal) fulfill();
      else reject(new DeploymentBuildError(step, { exitCode, signal }));
    });
  });
}

/** Inject spawn for process-boundary tests; ordinary builds inherit their complete deployment environment. */
export async function runDeploymentBuild({ env = process.env, spawn = spawnChild, node = process.execPath, cwd = root } = {}) {
  const options = { env, spawn, node, cwd };
  if (env.VERCEL_ENV === 'production') {
    await runStep('Production release verification', [
      '--experimental-strip-types', '--conditions=react-server', '--no-warnings',
      'scripts/production-release.ts', '--force', '--expected-endpoint-id',
      'ep-delicate-morning-avh7x6vk', '--allow-known-0009-crlf',
    ], options);
    await runStep('Production private file verification', [
      '--experimental-strip-types', '--conditions=react-server', '--no-warnings',
      'scripts/production-file-preflight.ts', '--force', '--expected-store-id',
      'store_NSTN5f48IHugiItT',
    ], options);
  } else {
    // Preserve migrate.mjs's existing preview/local guards, rather than replacing their policy here.
    await runStep('Migration guard', ['scripts/migrate.mjs'], options);
  }
  await runStep('Next build', ['node_modules/next/dist/bin/next', 'build'], options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeploymentBuild().catch(error => {
    console.error(`[deployment-build] ${error instanceof DeploymentBuildError ? error.message : 'Build orchestration failed.'}`);
    process.exitCode = error instanceof DeploymentBuildError ? error.exitCode : 1;
  });
}
