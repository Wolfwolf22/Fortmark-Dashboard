import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Input } from "../../components/ui/input";
import { dollarsToCents } from "../../lib/transactions/money";
function Check() {
 const [raw,setRaw]=useState(""),[result,setResult]=useState(null);
 return <main style={{maxWidth:600,margin:"60px auto",fontFamily:"Arial",padding:24}}><h1>Grouped number input check</h1><p>Synthetic local form only. No accounts, provider calls or stored records.</p><form onSubmit={event=>{event.preventDefault();const form=new FormData(event.currentTarget);setResult({amount:form.get("amount"),cents:dollarsToCents(String(form.get("amount")))});}}><label htmlFor="amount">Amount</label><Input id="amount" name="amount" type="number" value={raw} onChange={event=>setRaw(event.target.value)} min={0} step="0.01" required/><p>Raw change value: <output id="raw">{raw}</output></p><button type="submit">Read native FormData</button></form>{result&&<pre id="result">{JSON.stringify(result,null,2)}</pre>}</main>;
}
createRoot(document.getElementById("root")).render(<Check/>);
