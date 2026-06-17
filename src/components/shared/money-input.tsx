import { Input } from "@/components/ui/input";

export function MoneyInput(props: React.ComponentProps<typeof Input>) {
  return <Input inputMode="decimal" placeholder="R$ 0,00" {...props} />;
}
