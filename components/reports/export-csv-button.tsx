"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadCsv } from "./export-csv";

/**
 * The standard report-card export action: builds the CSV lazily from the
 * rendered dataset and downloads it as `fortmark-<report>-<preset>.csv`.
 */
export function ExportCsvButton({
  filename,
  getCsv,
  disabled,
}: {
  filename: string;
  /** Called on click — return the CSV string for the current dataset. */
  getCsv: () => string;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => downloadCsv(filename, getCsv())}
    >
      <Download aria-hidden />
      Export CSV
    </Button>
  );
}
