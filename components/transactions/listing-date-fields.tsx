"use client";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ListingDateFields({goLiveDate,expirationDate,onGoLiveDateChange,onExpirationDateChange,disabled}:{goLiveDate?:string;expirationDate?:string;onGoLiveDateChange?:(value:string)=>void;onExpirationDateChange?:(value:string)=>void;disabled?:boolean}) {
  const id=useId();
  return <div className="grid gap-3 sm:grid-cols-2">
    <div className="grid gap-1.5"><Label htmlFor={`${id}-go-live`}>Confirmed go-live date</Label><Input id={`${id}-go-live`} name="listingGoLiveDate" type="date" required disabled={disabled} value={goLiveDate} onChange={onGoLiveDateChange?event=>onGoLiveDateChange(event.target.value):undefined}/></div>
    <div className="grid gap-1.5"><Label htmlFor={`${id}-expiration`}>Contract expiration</Label><Input id={`${id}-expiration`} name="listingExpirationDate" type="date" required disabled={disabled} value={expirationDate} min={goLiveDate||undefined} onChange={onExpirationDateChange?event=>onExpirationDateChange(event.target.value):undefined}/></div>
  </div>;
}
