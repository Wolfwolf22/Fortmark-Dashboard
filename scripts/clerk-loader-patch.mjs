import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Clerk shared 4.x can check a cached script before its polling timer exists.
// Move that one readiness check after timer initialization. Authentication,
// signature verification and token handling are completely unchanged.
export function patchLoader(source){
 const start=source.indexOf('function waitForPredicateWithTimeout(');
 const end=source.indexOf('\nfunction setClerkJSLoadingErrorPackageName',start);
 if(start<0||end<0)throw new Error('Review Clerk loader patch after dependency update');
 const before=source.slice(start,end);
 if(before.includes('// FortMark: initialize timers before testing cached readiness.'))return source;
 const immediate='\t\tcheckAndResolve();\n\t\tconst pollInterval = setInterval(';
 const tail='\t\t}, 100);\n\t});';
 if(!before.includes(immediate)||!before.includes(tail))throw new Error('Review Clerk loader patch after dependency update');
 const after=before.replace(immediate,'\t\tconst pollInterval = setInterval(').replace(tail,'\t\t}, 100);\n\t\t// FortMark: initialize timers before testing cached readiness.\n\t\tcheckAndResolve();\n\t});');
 return source.slice(0,start)+after+source.slice(end);
}
export function applyLoaderPatch(){
 const require=createRequire(import.meta.url);
 const dist=dirname(require.resolve('@clerk/shared/loadClerkJsScript'));
 for(const name of ['loadClerkJsScript.js','loadClerkJsScript.mjs']){
  const path=join(dist,name),source=readFileSync(path,'utf8').replace(/\r\n/g,'\n');
  const fixed=patchLoader(source);if(fixed!==source)writeFileSync(path,fixed);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))applyLoaderPatch();
