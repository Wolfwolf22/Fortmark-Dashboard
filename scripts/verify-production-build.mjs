/** Compile the exact local application with no inherited credentials, network, migrations or shared build output. */
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, relative, resolve, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const SNAPSHOT_NAMES = ['app','components','lib','public','scripts','e2e','tools','package.json','package-lock.json','next.config.ts','next.config.js','next.config.mjs','middleware.ts','middleware.js','tsconfig.json','postcss.config.mjs','tailwind.config.ts','playwright.config.ts','playwright.launch.config.ts','drizzle.config.ts','next-env.d.ts','instrumentation.ts','instrumentation-client.ts','mdx-components.tsx'];
export function invalidAppExports(root) {
  const ts=createRequire(import.meta.url)('typescript'),allowed=new Set(['dynamic','dynamicParams','revalidate','fetchCache','runtime','preferredRegion','maxDuration','metadata','generateMetadata','viewport','generateViewport','generateStaticParams','config']),invalid=[];
  function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){const file=join(path,entry.name);if(entry.isDirectory())walk(file);else if(/^(?:page|layout)\.[jt]sx?$/.test(entry.name)){const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true);for(const node of source.statements){let names=[];if(ts.isExportDeclaration(node)&&!node.isTypeOnly)names=node.exportClause&&ts.isNamedExports(node.exportClause)?node.exportClause.elements.filter(e=>!e.isTypeOnly).map(e=>e.name.text):['*'];else if(ts.canHaveModifiers(node)){const modifiers=ts.getModifiers(node)||[];if(modifiers.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)&&!modifiers.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword))names=ts.isVariableStatement(node)?node.declarationList.declarations.map(d=>d.name.getText(source)):ts.isFunctionDeclaration(node)||ts.isClassDeclaration(node)?[node.name?.text]:[];}for(const name of names)if(name&&name!=='default'&&!allowed.has(name))invalid.push({path:relative(root,file),name});}}}}
  if(existsSync(join(root,'app')))walk(join(root,'app'));return invalid;
}
const excluded = name => name.startsWith('.env') || ['.git','.vercel','.next','node_modules','dist','.auth','.cache','test-results','playwright-report','blob-report'].includes(name) || /\.(?:pem|key|p12|tsbuildinfo)$/.test(name);
export function isolatedBuildEnv(guardFile, temporaryRoot) {
  return { PATH: `${dirname(process.execPath)}${delimiter}/usr/bin${delimiter}/bin`, TMPDIR: temporaryRoot, NODE_ENV:'production', NEXT_TELEMETRY_DISABLED:'1', CI:'1', NODE_OPTIONS:`--require=${guardFile}`,FM_ISOLATED_BUILD_NETWORK_LOG:join(temporaryRoot,'network-attempts.log'),
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('clerk.build.invalid$').toString('base64')}`, CLERK_SECRET_KEY:'sk_test_isolated_build_not_a_credential', NEXT_PUBLIC_APP_URL:'https://build.invalid',
    PROFILE_DATABASE_ENABLED:'0',CONTACTS_DATABASE_ENABLED:'0',TRANSACTIONS_DATABASE_ENABLED:'0',CALENDAR_DB_ENABLED:'0',SAMPLE_DASHBOARD_ENABLED:'0',MLS_LISTINGS_ENABLED:'0',AI_CHAT_PROVIDER_ENABLED:'0',AI_ACTIONS_ENABLED:'0',PROFILE_IMAGE_UPLOAD_ENABLED:'0',TRANSACTION_FILES_ENABLED:'0',SHOWING_TOUR_ROUTING_ENABLED:'0' };
}
function files(root, names) {
  const entries=[];
  function walk(path) { if(excluded(path.split('/').at(-1)))return;const full=join(root,path),stat=lstatSync(full);if(stat.isSymbolicLink())throw Error(`Build snapshot refuses source symlink: ${path}`);if(stat.isDirectory()){for(const name of readdirSync(full).sort())walk(`${path}/${name}`);}else if(stat.isFile())entries.push(path); }
  for(const name of names)if(existsSync(join(root,name)))walk(name);
  return entries.sort();
}
const digestFile = path => createHash('sha256').update(readFileSync(path)).digest('hex');
export function copyBuildSources(sourceRoot, destination) {
  const names=files(sourceRoot,SNAPSHOT_NAMES);mkdirSync(destination,{recursive:true});
  for(const name of names){mkdirSync(dirname(join(destination,name)),{recursive:true});cpSync(join(sourceRoot,name),join(destination,name));}
  const after=files(sourceRoot,SNAPSHOT_NAMES);if(JSON.stringify(after)!==JSON.stringify(names))throw Error('Source files changed during the build snapshot; run again after edits finish.');
  const manifest=names.map(name=>({path:name,sha256:digestFile(join(destination,name))}));
  if(manifest.some(file=>digestFile(join(sourceRoot,file.path))!==file.sha256))throw Error('Source content changed during the build snapshot; run again after edits finish.');
  return { files:manifest,sourceDigest:createHash('sha256').update(JSON.stringify(manifest)).digest('hex') };
}
async function command(executable,args,cwd,env,logFile){
  return new Promise((resolvePromise,reject)=>{const child=spawn(executable,args,{cwd,env,stdio:['ignore','pipe','pipe']}),timer=setTimeout(()=>{child.kill('SIGTERM');reject(Error('Isolated build exceeded ten minutes.'));},600000);let log='';
    const output=data=>{const text=String(data);log+=text;process.stdout.write(text);};child.stdout.on('data',output);child.stderr.on('data',output);child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);writeFileSync(logFile,log);code===0?resolvePromise():reject(Error(`Isolated build step exited ${code}; see ${logFile}`));});});
}
export async function runIsolatedBuild(sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..')) {
  const temporary=mkdtempSync(join(tmpdir(),'fortmark-production-build-')),snapshot=join(temporary,'source');console.log(`[isolated-build] Snapshot: ${snapshot}`);
  const manifest=copyBuildSources(sourceRoot,snapshot);writeFileSync(join(temporary,'source-manifest.json'),JSON.stringify(manifest,null,2));
  const exports=invalidAppExports(snapshot);if(exports.length)throw Error(`Invalid Next Page/Layout exports: ${exports.map(item=>`${item.path}: ${item.name}`).join(', ')}`);
  console.log(`[isolated-build] Captured ${manifest.files.length} source files; digest ${manifest.sourceDigest}`);
  // The real prebuild patches Clerk's installed loader. Copy dependencies so it cannot alter shared modules.
  console.log('[isolated-build] Copying installed dependencies into the disposable snapshot.');
  cpSync(join(sourceRoot,'node_modules'),join(snapshot,'node_modules'),{recursive:true,verbatimSymlinks:true,filter:path=>{const name=relative(join(sourceRoot,'node_modules'),path).split('/').at(-1);return !name.startsWith('.env')&&!['.cache','.git','.vercel','.auth'].includes(name);}});
  const clerkTarget=realpathSync(createRequire(join(snapshot,'package.json')).resolve('@clerk/shared/loadClerkJsScript'));
  if(!clerkTarget.startsWith(realpathSync(join(snapshot,'node_modules'))+'/'))throw Error('Dependency patch would escape the isolated snapshot.');
  const guard=join(snapshot,'scripts','isolated-build-network-guard.cjs'),env=isolatedBuildEnv(guard,temporary);
  console.log('[isolated-build] Environment allowlisted; synthetic auth keys; all data/provider flags off; network denied.');
  await command(process.execPath,[join(snapshot,'scripts','clerk-loader-patch.mjs')],snapshot,env,join(temporary,'prebuild.log'));
  await command(process.execPath,[join(snapshot,'node_modules','next','dist','bin','next'),'build'],snapshot,env,join(temporary,'build.log'));
  if(existsSync(env.FM_ISOLATED_BUILD_NETWORK_LOG)&&readFileSync(env.FM_ISOLATED_BUILD_NETWORK_LOG,'utf8').trim())throw Error(`Build attempted blocked network I/O; see ${env.FM_ISOLATED_BUILD_NETWORK_LOG}`);
  const runtimeFiles=manifest.files.filter(file=>/^(?:app|components|lib|public)\//.test(file.path)||/^(?:middleware\.|next\.config\.|postcss\.config\.|tailwind\.config\.)/.test(file.path));
  const runtimeSourceDigest=createHash('sha256').update(JSON.stringify(runtimeFiles)).digest('hex');
  const runtimeMatchesCurrent=runtimeFiles.every(file=>existsSync(join(sourceRoot,file.path))&&digestFile(join(sourceRoot,file.path))===file.sha256)&&files(sourceRoot,['app','components','lib','public','middleware.ts','middleware.js','next.config.ts','next.config.js','next.config.mjs','postcss.config.mjs','tailwind.config.ts']).length===runtimeFiles.length;
  const summary={sourceDigest:manifest.sourceDigest,runtimeSourceDigest,runtimeMatchesCurrent,snapshot,dist:join(snapshot,'.next'),buildId:readFileSync(join(snapshot,'.next','BUILD_ID'),'utf8').trim(),network:'denied',environment:'synthetic keys; no inherited env or credentials',migrations:'not invoked',workspaceSetup:'not invoked',runtimeCertification:false};writeFileSync(join(temporary,'result.json'),JSON.stringify(summary,null,2));
  console.log(`[isolated-build] PASS; artifacts and logs retained at ${temporary}`);return summary;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))runIsolatedBuild().catch(error=>{console.error(`[isolated-build] ${error.message}`);process.exitCode=1;});
