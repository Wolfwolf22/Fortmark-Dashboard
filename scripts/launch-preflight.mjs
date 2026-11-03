/** Prepare a future authenticated staging run; never contacts, logs into or mutates a target.
 * Rejects the production hosts verified during this launch review, not every possible
 * production alias. Independently verify deployment metadata for every other Vercel target.
 */
import { resolve } from 'node:path';import { fileURLToPath } from 'node:url';
const knownProductionHosts=new Set([
  'fortmark-dashboard.vercel.app',
  'fortmark-dashboard-daniels-projects-b97d8ae9.vercel.app',
  'fortmark-dashboard-3j5uenjh7-daniels-projects-b97d8ae9.vercel.app',
  'fortmark-app.vercel.app',
  'fortmark-app-daniels-projects-b97d8ae9.vercel.app',
  'fortmark-29056tiwq-daniels-projects-b97d8ae9.vercel.app',
]);
export function launchTargetPreflight(env=process.env){
  const origin=name=>{const value=env[name];if(!value)throw Error(`${name} must explicitly name the reviewed isolated target.`);let parsed;try{parsed=new URL(value);}catch{throw Error(`${name} is not a valid origin.`);}if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/')throw Error(`${name} must be an origin without credentials, path or query.`);if(knownProductionHosts.has(parsed.hostname))throw Error(`${name} is a known Production host and is refused.`);const loopback=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);if(!(loopback&&parsed.protocol==='http:')&&!(parsed.protocol==='https:'&&parsed.hostname.endsWith('.vercel.app')))throw Error(`${name} must be a reviewed Vercel target or local loopback; custom hosts are refused.`);return parsed.origin;};
  const portal=origin('CERT_PORTAL_URL'),dashboard=origin('CERT_DASHBOARD_URL');if(env.FM_LAUNCH_ISOLATED_DATABASE_CONFIRMED!=='1')throw Error('Confirm the target uses a dedicated disposable database before authenticated verification.');if(env.FM_LAUNCH_ALLOW_SYNTHETIC_WRITES!=='1')throw Error('Explicit synthetic-write authorization is required: legitimate sign-in can create the test profile.');
  const pk=env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY||env.CLERK_PUBLISHABLE_KEY;if(!pk?.startsWith('pk_test_')||!env.CLERK_SECRET_KEY?.startsWith('sk_test_'))throw Error('A development Clerk instance is required; live keys and missing credentials are refused.');
  return{portal,dashboard,targetIdentity:'known Production hosts denied; other Vercel targets require independent deployment metadata verification',databaseIsolation:'operator-attested; must be independently verified before release',syntheticWritesAuthorized:true,auth:'real development Clerk session required',automation:'not run',secrets:'never returned'};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(launchTargetPreflight(),null,2));}catch(error){console.error(`[launch-preflight] ${error.message}`);process.exitCode=1;}}
