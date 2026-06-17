import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function FormSection({
  title,
  fields,
  className,
}: {
  title: string;
  fields: string[];
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "stitch-animate-in stitch-hover-lift rounded-lg shadow-none",
        className,
      )}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {fields.map((field, index) => (
          <div
            key={field}
            className="stitch-animate-in-fast grid gap-2"
            style={{ animationDelay: `${index * 90 + 150}ms` }}
          >
            <Label>{field}</Label>
            {field.toLowerCase().includes("observ") || field.toLowerCase().includes("descr") ? (
              <Textarea placeholder={field} className="transition-all duration-300 focus:shadow-sm" />
            ) : (
              <Input placeholder={field} className="transition-all duration-300 focus:shadow-sm" />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
