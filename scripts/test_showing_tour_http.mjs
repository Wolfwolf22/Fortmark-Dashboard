/** Actual read-only tour HTTP boundaries, with synthetic auth/service and no network. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const folder = mkdtempSync(join(tmpdir(), "fortmark-showing-tour-http-"));
const next = `export const NextResponse={json:(body,options={})=>new Response(JSON.stringify(body),{...options,headers:{'Content-Type':'application/json',...options.headers}})};`;
const auth = `export async function requireCaller(){const s=globalThis.tourHttpState;s.authCalls++;return s.auth?{ok:true,clerkUserId:'synthetic'}:{ok:false,response:Response.json({error:'Unauthorized'},{status:401,headers:{'Cache-Control':'private, no-store'}})}}`;
const contacts = `
 export const NO_STORE={'Cache-Control':'private, no-store'};
 export const contactsSource=()=>globalThis.tourHttpState.source;
 export async function actorOrResponse(){const s=globalThis.tourHttpState;s.actorCalls++;return {ok:true,ctx:{actor:{userId:'11111111-1111-4111-8111-111111111111',role:s.role,brokerageKey:'fortmark'},db:{}}};}
 export function failure(reason){return Response.json({error:reason},{status:reason==='not_found'?404:reason==='forbidden'||reason==='no_identity'?403:503,headers:NO_STORE});}
 export function unexpected(){return Response.json({error:'Service unavailable'},{status:503,headers:NO_STORE});}
`;
const mls = `export function createContactPropertyMlsProvider(){globalThis.tourHttpState.mlsProviders++;return {synthetic:true};}`;
const routing = `export function createTourRoutingProvider(){globalThis.tourHttpState.routingProviders++;return {map:{kind:'google',browserKey:'public-restricted-browser-key'}};}`;
const service = `
 async function run(name,args){const s=globalThis.tourHttpState;s.calls.push({name,args});if(s.throwService)throw Error('Private location and server key');return s.answers[name]??{ok:true,value:s.values[name]};}
 export const getShowingTour=(...args)=>run('context',args),recommendShowingTour=(...args)=>run('recommendation',args);
`;
const entry = `
 import assert from 'node:assert/strict';
 import {readTourBody,tourFailure} from './lib/showings/tour-http';
 import * as route from './app/api/showings/[id]/tour/route';
 (async()=>{
 const id='22222222-2222-4222-8222-222222222222',url='https://synthetic.invalid/api/showings/'+id+'/tour';
 const value={showingId:id,stops:[],map:{kind:'google',browserKey:'public-restricted-browser-key'},contextToken:'a'.repeat(64)};
 const recommendation={orderedPropertyIds:[id],source:'sample',resolvedStops:[]};
 const s=globalThis.tourHttpState={auth:true,source:'db',role:'agent',authCalls:0,actorCalls:0,mlsProviders:0,routingProviders:0,calls:[],answers:{},values:{context:value,recommendation}};
 let checks=0;function check(value,label){assert.ok(value,label);checks++;}
 const context={params:Promise.resolve({id})};
 const post=(body,headers={},suffix='')=>new Request(url+suffix,{method:'POST',body,headers});
 const stream=(bytes,headers={})=>new Request(url,{method:'POST',body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}}),headers,duplex:'half'});
 const emptyCalls=()=>{s.calls=[];s.mlsProviders=0;s.routingProviders=0;};
 const privateResponse=response=>response.headers.get('Cache-Control')==='private, no-store';
 check((await readTourBody(post(JSON.stringify({contextToken:'a'.repeat(64)})))).ok,'valid JSON body accepted');
 check((await readTourBody(post('"'+'x'.repeat(16382)+'"'))).ok,'exact16KiB JSON body accepted');
 check(!(await readTourBody(stream(new TextEncoder().encode('"'+'x'.repeat(16383)+'"'),{'content-length':'1'}))).ok,'actual streamed bytes enforce limit despite false content length');
 check(!(await readTourBody(post('{}',{'content-length':'16385'}))).ok,'oversized declared body rejected early');
 check(!(await readTourBody(stream(new Uint8Array([0xff,0xfe])))).ok,'invalid UTF8 rejected');
 check(!(await readTourBody(post('{bad'))).ok,'malformed JSON rejected');
 check(!(await readTourBody(new Request(url,{method:'POST'}))).ok,'missing request body rejected');
 s.auth=false;emptyCalls();const unauth=await route.GET(new Request(url),context);
 check(unauth.status===401&&privateResponse(unauth)&&s.calls.length===0&&s.mlsProviders===0&&s.routingProviders===0&&s.actorCalls===0,'auth precedes service and all provider construction');s.auth=true;
 s.source='sample';const sample=await route.POST(post('{}'),context);
 check(sample.status===404&&privateResponse(sample)&&s.calls.length===0&&s.actorCalls===0,'real routes never substitute sample tour data');s.source='db';
 const badId=await route.GET(new Request(url),{params:Promise.resolve({id:'not-a-uuid'})});
 check(badId.status===404&&s.actorCalls===0&&s.calls.length===0,'invalid showing ID rejected before actor/provider lookup');
 for(const query of ['?page=0','?page=1&page=2','?latitude=26','?contactName=Private','?page=1000001']){emptyCalls();const invalid=await route.GET(new Request(url+query),context);check(invalid.status===400&&privateResponse(invalid)&&s.calls.length===0&&s.mlsProviders===0&&s.routingProviders===0,'invalid context query never reaches service or provider');}
 emptyCalls();const loaded=await route.GET(new Request(url+'?page=2'),context);
 check(loaded.status===200&&privateResponse(loaded)&&JSON.stringify(await loaded.json())===JSON.stringify(value),'GET returns bare private context');
 check(s.calls.length===1&&s.calls[0].name==='context'&&s.calls[0].args[4].page===2&&s.mlsProviders===1&&s.routingProviders===1,'GET passes bounded page and lazy providers');
 const body={selectedPropertyIds:[id,'33333333-3333-4333-8333-333333333333'],startPropertyId:'auto',startsAt:'2026-11-03T15:00:00Z',respectAppointments:true,bufferMinutes:5,returnToStart:false,contextToken:'a'.repeat(64)};
 s.role='member';emptyCalls();const planned=await route.POST(post(JSON.stringify(body)),context);
 check(planned.status===200&&privateResponse(planned)&&JSON.stringify(await planned.json())===JSON.stringify(recommendation),'member may calculate read-only recommendation without write grant');
 check(s.calls.length===1&&s.calls[0].name==='recommendation'&&JSON.stringify(s.calls[0].args[2])===JSON.stringify(body),'POST passes authoritative-selection input without mutation endpoint');s.role='agent';
 for(const suffix of ['?page=1','?contactName=Private','?coords=26,-80']){emptyCalls();const invalid=await route.POST(post('{}',{},suffix),context);check(invalid.status===400&&s.calls.length===0&&s.mlsProviders===0&&s.routingProviders===0,'POST refuses all query parameters to keep customer/route input in body');}
 emptyCalls();const malformed=await route.POST(post('{'),context);
 check(malformed.status===400&&privateResponse(malformed)&&s.calls.length===0&&s.mlsProviders===0&&s.routingProviders===0,'invalid JSON never reaches service/provider');
 for(const reason of ['invalid_tour_query','invalid_tour_plan','invalid_route','stale_context','source_unavailable','unresolved_stops','unreachable','infeasible','not_configured','not_found','forbidden','unavailable']){
   const response=tourFailure(reason),expected=['invalid_tour_query','invalid_tour_plan','invalid_route'].includes(reason)?400:['stale_context','source_unavailable','unresolved_stops'].includes(reason)?409:['unreachable','infeasible'].includes(reason)?422:reason==='not_found'?404:reason==='forbidden'?403:503;
   check(response.status===expected&&privateResponse(response)&&JSON.stringify(await response.json())===JSON.stringify({error:reason}),'controlled errors contain no locations, names, private keys or source records');
 }
 s.answers.context={ok:false,reason:'not_found'};const missing=await route.GET(new Request(url),context);check(missing.status===404&&privateResponse(missing),'out-of-scope service failure remains404');delete s.answers.context;
 s.answers.recommendation={ok:false,reason:'stale_context'};const stale=await route.POST(post(JSON.stringify(body)),context);check(stale.status===409&&privateResponse(stale)&&(await stale.json()).error==='stale_context','changed context is an explicit409');delete s.answers.recommendation;
 s.throwService=true;const failed=await route.POST(post(JSON.stringify(body)),context);check(failed.status===503&&privateResponse(failed)&&!JSON.stringify(await failed.json()).includes('Private'),'unexpected failure never echoes location or provider secrets');
 console.log(checks+'/'+checks+' showing tour HTTP checks passed (synthetic auth/service; no network)');
 })().catch(error=>{console.error(error);process.exitCode=1;});
`;
try {
  const bundled = await build({ stdin: { contents: entry, resolveDir: root, loader: "ts" }, bundle: true, platform: "node", format: "cjs", write: false, plugins: [{ name: "showing-tour-http-boundaries", setup(builder) {
    const fixtures = new Map([["next/server", next], ["auth/require-caller", auth], ["contacts/http", contacts], ["contacts/property-mls", mls], ["showings/tour-routing", routing], ["showings/tour-service", service]]);
    builder.onResolve({ filter: /(?:^next\/server$|auth\/require-caller(?:\.ts)?$|contacts\/http(?:\.ts)?$|contacts\/property-mls(?:\.ts)?$|showings\/tour-routing(?:\.ts)?$|showings\/tour-service(?:\.ts)?$)/ }, args => {
      const key = [...fixtures.keys()].find(name => args.path.replace(/\.ts$/, "").endsWith(name));
      return key ? { path: key, namespace: "synthetic-tour-http" } : undefined;
    });
    builder.onLoad({ filter: /.*/, namespace: "synthetic-tour-http" }, args => ({ contents: fixtures.get(args.path), loader: "ts" }));
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty-server" }));
    builder.onLoad({ filter: /.*/, namespace: "empty-server" }, () => ({ contents: "", loader: "js" }));
  } }] });
  const output = join(folder, "showing-tour-http.cjs");
  writeFileSync(output, bundled.outputFiles[0].contents);
  const result = spawnSync(process.execPath, [output], { encoding: "utf8", timeout: 30000 });
  process.stdout.write(result.stdout); process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error("Showing tour HTTP checks failed");
} finally { rmSync(folder, { recursive: true, force: true }); }
