"use client";
import { useParams } from "next/navigation";
import { TransactionWorkspaceView } from "@/components/transactions/transaction-workspace";
export default function Page() { const params = useParams<{id:string}>(); return <TransactionWorkspaceView key={params.id} id={params.id} />; }
