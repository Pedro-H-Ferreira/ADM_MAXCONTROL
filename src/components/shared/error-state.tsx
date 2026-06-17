import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ErrorState({
  title = "Não foi possível carregar os dados",
}: {
  title?: string;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>Verifique a conexão com Supabase e tente novamente.</AlertDescription>
    </Alert>
  );
}
