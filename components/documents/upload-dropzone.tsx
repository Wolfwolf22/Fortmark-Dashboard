"use client";

/**
 * Upload dropzone stub — accepts a drop or browse, then confirms the
 * document name, transaction, and kind in a small dialog before handing the
 * record to the documents adapter (it lands as pending signature). No bytes
 * leave the browser; this is the seam for the future document service.
 */
import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { addDocument } from "@/lib/data/adapters/documents";
import { Transaction, TransactionDocument } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { DOCUMENT_KIND_LABELS, DOCUMENT_KINDS } from "./doc-shared";

type DocumentKind = TransactionDocument["kind"];

export function UploadDropzone({
  transactions,
  defaultTransactionId,
}: {
  transactions: Transaction[] | undefined;
  defaultTransactionId?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [kind, setKind] = useState<DocumentKind>("contract");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dragDepth = useRef(0);

  const activeTransactions = (transactions ?? []).filter(
    (t) => t.stage !== "closed"
  );

  function openWith(file: File) {
    const base = file.name.replace(/\.[^.]+$/, "").trim();
    setFileName(file.name);
    setName(base || file.name);
    setTransactionId(
      defaultTransactionId &&
        activeTransactions.some((t) => t.id === defaultTransactionId)
        ? defaultTransactionId
        : ""
    );
    setKind("contract");
    setError(null);
    setDialogOpen(true);
  }

  function handleDrop(event: React.DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) openWith(file);
  }

  function handleSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) openWith(file);
    event.target.value = "";
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const transaction = activeTransactions.find((t) => t.id === transactionId);
    if (!transaction || !name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await addDocument({
        transactionId: transaction.id,
        address: transaction.address,
        name: name.trim(),
        kind,
      });
      setDialogOpen(false);
    } catch {
      setError("Could not add the document. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current -= 1;
          if (dragDepth.current <= 0) {
            dragDepth.current = 0;
            setDragging(false);
          }
        }}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center gap-1 rounded-card border-2 border-dashed border-input bg-card px-6 py-8 text-center transition-colors duration-150",
          dragging && "border-foreground bg-tint"
        )}
      >
        <Upload className="mb-1 h-5 w-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold">
          Drop files here or{" "}
          <label className="cursor-pointer rounded-sm underline underline-offset-4 transition-colors duration-150 hover:text-muted-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background">
            browse
            <input type="file" className="sr-only" onChange={handleSelect} />
          </label>
        </p>
        <p className="text-xs text-muted-foreground">
          Files stay local until the document service connects.
        </p>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add document</DialogTitle>
            <DialogDescription>
              {fileName} — confirm the name and choose its file. It lands as
              pending signature.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="upload-doc-name">Document name</Label>
              <Input
                id="upload-doc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upload-doc-transaction">Transaction</Label>
              <Select value={transactionId} onValueChange={setTransactionId}>
                <SelectTrigger id="upload-doc-transaction">
                  <SelectValue placeholder="Choose a transaction" />
                </SelectTrigger>
                <SelectContent>
                  {activeTransactions.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.address} — {t.clientName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="upload-doc-kind">Kind</Label>
              <Select
                value={kind}
                onValueChange={(v) => setKind(v as DocumentKind)}
              >
                <SelectTrigger id="upload-doc-kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {DOCUMENT_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-status-bad">{error}</p>}
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={saving || !transactionId || !name.trim()}
              >
                Add document
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
