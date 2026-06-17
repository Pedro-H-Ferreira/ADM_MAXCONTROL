import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ActionMenu } from "@/components/shared/action-menu";
import { StatusBadge } from "@/components/shared/status-badge";
import type { TableRow as AdminTableRow } from "@/lib/admin-data";

export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: AdminTableRow[];
}) {
  return (
    <div className="stitch-animate-in overflow-hidden rounded-lg border bg-card">
      <Table>
        <TableHeader className="bg-muted/60">
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column} className="h-10 text-xs uppercase tracking-[0.08em]">
                {column}
              </TableHead>
            ))}
            <TableHead className="h-10 w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, rowIndex) => (
            <TableRow
              key={rowIndex}
              className="stitch-animate-in-fast h-11 transition-all duration-200 hover:-translate-y-px hover:bg-muted/50 hover:shadow-sm"
              style={{ animationDelay: `${Math.min(rowIndex * 70 + 150, 800)}ms` }}
            >
              {columns.map((column) => {
                const value = row[column] ?? "";
                const isStatus = column.toLowerCase() === "status";
                return (
                  <TableCell key={column} className="text-sm">
                    {isStatus ? <StatusBadge status={value} /> : value}
                  </TableCell>
                );
              })}
              <TableCell>
                <ActionMenu />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
