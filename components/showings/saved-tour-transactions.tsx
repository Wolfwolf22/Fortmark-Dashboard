"use client";
import Link from "next/link";
import { ArrowUpRight, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconWell } from "@/components/ui/icon-well";
import { useQuery } from "@/lib/data/hooks";
import { getSavedTourTransactions } from "@/lib/data/adapters/transaction-tours";
import { transactionFailure } from "@/components/transactions/workspace-state";
import { tourMatchLabel } from "@/lib/transactions/tour-link-domain";
export function SavedTourTransactionsCard({tourId,updatedAt}:{tourId:string;updatedAt:string}) { const query=useQuery(()=>getSavedTourTransactions(tourId),[tourId,updatedAt]),data=query.data?.tourId===tourId&&!query.error?query.data:undefined;return <Card className="min-w-0 p-4 sm:p-5"><div className="flex items-center gap-2.5"><IconWell icon={Building2}/><h3 className="text-base font-semibold">Related transactions</h3></div><p className="mt-3 text-xs text-muted-foreground">Files you can access that are explicitly linked to this private tour.</p>{query.error&&<p role="alert" className="mt-3 text-sm">{transactionFailure(query.error)} <Button type="button" size="sm" variant="ghost" onClick={query.refetch}>Retry</Button></p>}{data?.items.length?<ul className="mt-4 divide-y divide-border">{data.items.map(item=><li key={item.id} className="py-3 first:pt-0"><Link href={`/transactions/${encodeURIComponent(item.id)}`} className="inline-flex min-h-10 items-center gap-2 break-words text-sm font-semibold hover:underline">{item.address}<ArrowUpRight aria-hidden className="h-3.5 w-3.5 shrink-0"/></Link><p className="text-xs text-muted-foreground">{item.city} · {item.stage.replaceAll("_"," ")}</p><p className="mt-1 text-xs text-muted-foreground">{tourMatchLabel(item.propertyMatch)}</p></li>)}</ul>:<p className="mt-4 text-sm text-muted-foreground">{query.loading?"Loading related files…":"No linked transactions available. Open a transaction file to link this plan."}</p>}{data?.truncated&&<p className="mt-3 text-xs text-muted-foreground">Showing the latest {data.limit} visible files.</p>}</Card>; }
