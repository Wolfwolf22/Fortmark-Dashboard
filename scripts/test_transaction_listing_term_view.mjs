/** Actual required date controls and shared validators. No network, provider or live database. */
import {build} from "esbuild";
import {mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL("../",import.meta.url)),temp=mkdtempSync(join(tmpdir(),"fortmark-listing-term-"));
try{
const entry=`
import assert from "node:assert/strict";import React from "react";import {renderToStaticMarkup} from "react-dom/server";
import {TransactionCreateFields} from "./components/layout/quick-create-dialog";
import {ListingDateFields} from "./components/transactions/listing-date-fields";
import {confirmedListingDatesSchema,suggestedListingGoLiveDate} from "./lib/transactions/listing-term";
import {createTransactionSchema} from "./lib/transactions/validation";
import {transactionWorkflowMutationSchema,listingPlanSchema,EMPTY_LISTING_PLAN} from "./lib/transactions/workflow-domain";
import {reviewedTransactionPropertyInput} from "./components/transactions/property-state";
import {transactionCreateAttempt} from "./lib/transactions/create-attempt";
const render=value=>renderToStaticMarkup(value),noop=()=>{},id="80000000-0000-4000-8000-000000000001",stamp="2027-01-02T15:00:00.000Z";let checks=0,calls=0;globalThis.fetch=async()=>{calls++;throw Error("No network")};function check(name,run){run();checks++;console.log("PASS "+name)};
for(const side of["listing","landlord","dual"])check(side+" creation exposes two real required date fields",()=>{const html=render(<TransactionCreateFields side={side} onSideChange={noop}/>);for(const name of["listingGoLiveDate","listingExpirationDate"]){const field=html.match(new RegExp('<input[^>]*name="'+name+'"[^>]*>'))?.[0];assert(field);assert(field.includes('required=""'));assert(field.includes('type="date"'));assert(!field.includes('value="202'));}assert(html.includes("Confirmed go-live date"));assert(!html.includes("Go-live date (optional)"));});
for(const side of["buyer","tenant","gc"])check(side+" does not inherit listing term controls",()=>{const html=render(<TransactionCreateFields side={side} onSideChange={noop}/>);assert(!html.includes('name="listingGoLiveDate"'));assert(!html.includes('name="listingExpirationDate"'));});
check("MLS review date controls show the saved pair with expiration lower bound",()=>{const html=render(<ListingDateFields goLiveDate="2026-10-01" expirationDate="2027-01-01" onGoLiveDateChange={noop} onExpirationDateChange={noop}/>);assert(html.includes('value="2026-10-01"'));assert(html.includes('value="2027-01-01"'));assert(html.includes('min="2026-10-01"'));assert.equal((html.match(/required=""/g)||[]).length,2);});
check("confirmed dates reject impossible reversed missing and timestamp entries",()=>{for(const pair of[{},{goLiveDate:"2026-10-01"},{goLiveDate:"2026-02-30",expirationDate:"2026-12-01"},{goLiveDate:"2027-02-01",expirationDate:"2027-01-01"},{goLiveDate:stamp,expirationDate:"2027-12-01"}])assert(!confirmedListingDatesSchema.safeParse(pair).success);assert(confirmedListingDatesSchema.safeParse({goLiveDate:"2026-10-01",expirationDate:"2027-01-01"}).success);});
check("creation validator requires the pair for all listing sides and leaves buyer unchanged",()=>{const base={transactionType:"residential_sale",addressLine1:"Synthetic property",city:"Test"};for(const side of["listing","landlord","dual"]){assert(!createTransactionSchema.safeParse({...base,side}).success);assert(createTransactionSchema.safeParse({...base,side,listingGoLiveDate:"2026-10-01",listingExpirationDate:"2027-01-01"}).success);}assert(createTransactionSchema.safeParse({...base,side:"buyer"}).success);});
check("workflow mutations cannot erase required dates while legacy read shape stays valid",()=>{assert(listingPlanSchema.safeParse(EMPTY_LISTING_PLAN).success);for(const status of["draft","active","extended"]){assert(!transactionWorkflowMutationSchema.safeParse({requestId:id,expectedUpdatedAt:stamp,action:"listing_plan",plan:{...EMPTY_LISTING_PLAN,status,reason:"Reviewed"}}).success);}});
check("only an actual valid MLS listing date is suggested without inventing one from DOM",()=>{assert.equal(suggestedListingGoLiveDate("2026-10-01T12:00:00Z"),"2026-10-01");assert.equal(suggestedListingGoLiveDate("2026-10-01"),"2026-10-01");for(const invalid of[null,undefined,"","2026-02-30T12:00:00Z","12 days on market","2026-10-01garbage"])assert.equal(suggestedListingGoLiveDate(invalid),null);});
check("reviewed MLS payload and unknown create retry freeze exact agent-confirmed dates",()=>{const dates={goLiveDate:"2026-09-15",expirationDate:"2027-05-01"},preview={transactionId:id,expectedUpdatedAt:stamp,reference:{dataset:"miamire",listingId:"listing-key",mlsNumber:"A00123"},listing:{id:"listing-key",mlsNumber:"A00123",address:"Property",city:"Test",state:"FL",zip:"33308",listPrice:500000},importFingerprint:"a".repeat(64)},payload=reviewedTransactionPropertyInput(preview,true,true,id,dates);assert.deepEqual(payload.listingDates,dates);assert.equal("listingDates" in reviewedTransactionPropertyInput(preview,true,true,id),false);const first=transactionCreateAttempt(null,{side:"listing",address:"Property",city:"Test",clientName:"Client",contractPrice:1,listingGoLiveDate:dates.goLiveDate,listingExpirationDate:dates.expirationDate},false,()=>id),retry=transactionCreateAttempt(first,{...first.input,listingExpirationDate:"2028-01-01"},true,()=>{throw Error("Must retain UUID")});assert.equal(retry,first);assert.equal(retry.input.listingExpirationDate,"2027-05-01");});
assert.equal(calls,0);console.log(checks+"/"+checks+" listing term view and validator checks passed");
`;
const output=await build({stdin:{contents:entry,resolveDir:root,loader:"tsx"},bundle:true,platform:"node",format:"cjs",jsx:"automatic",write:false}),path=join(temp,"listing-term.cjs");writeFileSync(path,output.outputFiles[0].contents);const result=spawnSync(process.execPath,[path],{stdio:"inherit"});if(result.error)throw result.error;if(result.status!==0)throw Error("Listing term checks failed");
}finally{rmSync(temp,{recursive:true,force:true});}
