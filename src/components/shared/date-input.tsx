import { Input } from "@/components/ui/input";

export function DateInput(props: React.ComponentProps<typeof Input>) {
  return <Input type="date" {...props} />;
}
