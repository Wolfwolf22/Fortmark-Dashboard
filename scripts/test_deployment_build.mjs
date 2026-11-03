/** Process-boundary checks only: no migration, Next build, database or network call is executed. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { DeploymentBuildError, runDeploymentBuild } from './deployment-build.mjs';

let checks = 0;
function check(name, value) { assert.ok(value, name); checks++; console.log(`PASS ${name}`); }
const node = '/synthetic/node', cwd = '/synthetic/source';
const releaseArgs = ['--experimental-strip-types', '--conditions=react-server', '--no-warnings', 'scripts/production-release.ts', '--force', '--expected-endpoint-id', 'ep-delicate-morning-avh7x6vk', '--allow-known-0009-crlf'];
const fileArgs = ['--experimental-strip-types', '--conditions=react-server', '--no-warnings', 'scripts/production-file-preflight.ts', '--force', '--expected-store-id', 'store_NSTN5f48IHugiItT'];
const nextArgs = ['node_modules/next/dist/bin/next', 'build'];
function harness(outcomes = []) {
  const calls = [], children = [];
  function spawn(command, args, options) {
    const index = calls.length;
    calls.push({ command, args, options });
    const outcome = outcomes[index] ?? { code: 0 };
    if (outcome.throw) throw Error('synthetic-secret-that-must-not-be-logged');
    const child = new EventEmitter(); children.push(child);
    if (!outcome.hold) queueMicrotask(() => {
      if (outcome.error) child.emit('error', Error('synthetic-secret-that-must-not-be-logged'));
      child.emit('close', outcome.code ?? null, outcome.signal ?? null);
    });
    return child;
  }
  return { spawn, calls, children };
}
async function refusal(env, outcomes) {
  const test = harness(outcomes);
  let failure;
  try { await runDeploymentBuild({ ...test, env, node, cwd }); }
  catch (error) { failure = error; }
  assert.ok(failure instanceof DeploymentBuildError);
  return { ...test, failure };
}

{
  const env = { VERCEL_ENV: 'production', DATABASE_URL: 'synthetic-private-url', PROFILE_DATABASE_ENABLED: '1', NODE_OPTIONS: '--synthetic-option' }, test = harness();
  await runDeploymentBuild({ ...test, env, node, cwd });
  check('production executes endpoint-pinned database verification, approved private-file verification, then Next', test.calls.length === 3 && JSON.stringify(test.calls[0].args) === JSON.stringify(releaseArgs) && JSON.stringify(test.calls[1].args) === JSON.stringify(fileArgs) && JSON.stringify(test.calls[2].args) === JSON.stringify(nextArgs));
  check('production never invokes the legacy migration guard', test.calls.every(call => !call.args.includes('scripts/migrate.mjs')));
  check('each child inherits the exact deployment environment and source directory', test.calls.every(call => call.options.env === env && call.options.cwd === cwd));
  check('children use the current Node executable, inherited output and no shell', test.calls.every(call => call.command === node && call.options.stdio === 'inherit' && call.options.shell === false));
  check('the runner leaves environment values unchanged', env.DATABASE_URL === 'synthetic-private-url' && env.NODE_OPTIONS === '--synthetic-option');
  check('npm prebuild remains separate: the orchestrator does not repeat the Clerk patch', test.calls.every(call => !call.args.some(arg => arg.includes('clerk-loader-patch'))));
}
for (const vercelEnv of ['preview', 'development', undefined, 'Production', '']) {
  const test = harness();
  await runDeploymentBuild({ ...test, env: { VERCEL_ENV: vercelEnv }, node, cwd });
  check(`${String(vercelEnv)} preserves the legacy guard then Next order`, test.calls.length === 2 && JSON.stringify(test.calls[0].args) === JSON.stringify(['scripts/migrate.mjs']) && JSON.stringify(test.calls[1].args) === JSON.stringify(nextArgs));
}
{
  const test = harness([{ hold: true }, { hold: true }, { hold: true }]);
  const pending = runDeploymentBuild({ ...test, env: { VERCEL_ENV: 'production' }, node, cwd });
  check('Next cannot start while production verification is still running', test.calls.length === 1);
  test.children[0].emit('close', 0, null);
  await Promise.resolve();
  check('only the private-file gate starts after database verification closes successfully', test.calls.length === 2 && JSON.stringify(test.calls[1].args) === JSON.stringify(fileArgs));
  test.children[1].emit('close', 0, null);
  await Promise.resolve();
  check('Next starts only after the private-file gate also closes successfully', test.calls.length === 3 && JSON.stringify(test.calls[2].args) === JSON.stringify(nextArgs));
  test.children[2].emit('close', 0, null);
  await pending;
}
for (const outcome of [{ code: 7 }, { code: null }, { signal: 'SIGTERM' }, { error: true }, { throw: true }]) {
  const result = await refusal({ VERCEL_ENV: 'production' }, [outcome]);
  check(`production refusal stops without fallback, retry or Next (${JSON.stringify(outcome)})`, result.calls.length === 1 && result.failure.step === 'Production release verification');
  check(`production refusal has a nonzero sanitized result (${JSON.stringify(outcome)})`, result.failure.exitCode > 0 && !result.failure.message.includes('synthetic-secret'));
}
for (const outcome of [{ code: 7 }, { code: null }, { signal: 'SIGTERM' }, { error: true, code: 0 }, { throw: true }]) {
  const result = await refusal({ VERCEL_ENV: 'production' }, [{ code: 0 }, outcome]);
  check(`private-file refusal stops without retry, fallback or Next (${JSON.stringify(outcome)})`, result.calls.length === 2 && result.failure.step === 'Production private file verification');
  check(`private-file refusal has a nonzero sanitized result (${JSON.stringify(outcome)})`, result.failure.exitCode > 0 && !result.failure.message.includes('synthetic-secret'));
}
{
  const exited = await refusal({ VERCEL_ENV: 'production' }, [{ code: 23 }]);
  check('a child failure preserves its nonzero exit code', exited.failure.exitCode === 23);
  const signalled = await refusal({ VERCEL_ENV: 'production' }, [{ signal: 'SIGTERM' }]);
  check('a terminated child produces the conventional failing signal exit code', signalled.failure.exitCode === 143 && signalled.failure.signal === 'SIGTERM');
  const invalid = await refusal({ VERCEL_ENV: 'production' }, [{ code: 0, signal: 'SIGTERM' }]);
  check('a signal is never accepted as successful even if exit code is zero', invalid.calls.length === 1 && invalid.failure.exitCode !== 0);
}
for (const env of [{ VERCEL_ENV: 'production' }, { VERCEL_ENV: 'preview' }]) {
  const outcomes = env.VERCEL_ENV === 'production' ? [{ code: 0 }, { code: 0 }, { code: 11 }] : [{ code: 0 }, { code: 11 }];
  const result = await refusal(env, outcomes);
  check(`${env.VERCEL_ENV} propagates a failing Next build without retry`, result.calls.length === outcomes.length && result.failure.step === 'Next build' && result.failure.exitCode === 11);
}
{
  const result = await refusal({ VERCEL_ENV: 'preview' }, [{ code: 9 }]);
  check('a failing legacy guard also prevents Next rather than being ignored by the wrapper', result.calls.length === 1 && result.failure.step === 'Migration guard' && result.failure.exitCode === 9);
}
console.log(`${checks}/${checks} deployment-build checks passed (injected processes; no live operations)`);
