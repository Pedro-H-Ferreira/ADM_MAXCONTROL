import { UploadCloud } from "lucide-react";

export function UploadField() {
  return (
    <div className="stitch-hover-lift group flex min-h-28 items-center justify-center rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5">
      <div>
        <UploadCloud className="mx-auto mb-2 size-5 transition-transform duration-200 group-hover:-translate-y-0.5" />
        PDF, PNG, JPG, JPEG ou WEBP
      </div>
    </div>
  );
}
