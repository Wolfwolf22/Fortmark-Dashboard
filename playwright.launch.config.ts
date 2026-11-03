/** Future operator-invoked staging smoke only. Loading this config never falls back to a remote target. */
import { defineConfig, devices } from "@playwright/test";
import { launchTargetPreflight } from "./scripts/launch-preflight.mjs";
const target=launchTargetPreflight();
export default defineConfig({testDir:"./e2e",fullyParallel:false,workers:1,retries:0,timeout:180_000,globalTimeout:20*60_000,maxFailures:1,reporter:[["list"]],outputDir:"./test-results/launch",use:{baseURL:target.portal,actionTimeout:30_000,navigationTimeout:60_000,trace:"off",screenshot:"off",video:"off",...devices["Desktop Chrome"],launchOptions:process.env.PW_EXECUTABLE_PATH?{executablePath:process.env.PW_EXECUTABLE_PATH}:undefined},projects:[{name:"setup",testMatch:/global\.setup\.ts/},{name:"launch-smoke",testMatch:/api-smoke\.spec\.ts/,dependencies:["setup"]}]});
