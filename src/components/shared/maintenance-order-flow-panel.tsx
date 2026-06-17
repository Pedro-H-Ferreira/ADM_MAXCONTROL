"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Clock,
  Hammer,
  PackageOpen,
  Smartphone,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  fluigMaintenanceFields,
  getMaintenanceQueue,
  maintenanceMobileStatuses,
  manualMaintenanceFields,
  type MaintenanceFormField,
} from "@/lib/maintenance-data";
import { cn } from "@/lib/utils";

type MaintenanceOrderFlowPanelProps = {
  mode: "list" | "form" | "detail";
  compact?: boolean;
};

export function MaintenanceOrderFlowPanel({ mode, compact = false }: MaintenanceOrderFlowPanelProps) {
  const queue = useMemo(() => getMaintenanceQueue(), []);
  const openCount = queue.filter((order) => order.status !== "FINALIZADA").length;
  const startedCount = queue.filter((order) => order.status === "INICIADA").length;
  const waitingMaterialCount = queue.filter((order) => order.status === "AGUARDANDO_MATERIAL").length;
  const photoCount = queue.filter((order) => order.photos > 0).length;

  if (mode === "form") {
    return <MaintenanceNewOrderSelector />;
  }

  return (
    <Card className="stitch-animate-in stitch-hover-lift rounded-lg shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border bg-muted/50 px-2 py-1 text-xs font-medium text-muted-foreground">
                OS da ferramenta
              </span>
              <StatusBadge status="INICIADA" />
            </div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4" />
              Fluxo manual de manutencao do CD
            </CardTitle>
            <p className="max-w-3xl text-sm text-muted-foreground">
              Ordens que nao entram no Fluig ficam na ferramenta, com fila para celular, prioridade, status,
              material utilizado, valor gasto e fotos da execucao.
            </p>
          </div>
          <Button type="button" variant="outline" className="stitch-soft-button w-fit">
            <Smartphone className="size-4" />
            Visao manutentor
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <SummaryTile icon={Clock} label="Abertas" value={String(openCount)} />
          <SummaryTile icon={Hammer} label="Iniciadas" value={String(startedCount)} />
          <SummaryTile icon={PackageOpen} label="Aguardando material" value={String(waitingMaterialCount)} />
          <SummaryTile icon={Camera} label="Com fotos" value={String(photoCount)} />
        </div>
        {compact ? <CompactMaintenanceQueue queue={queue} /> : <FullMaintenanceQueue queue={queue} />}
      </CardContent>
    </Card>
  );
}

function MaintenanceNewOrderSelector() {
  const [flow, setFlow] = useState<"manual" | "fluig">("manual");
  const fields = flow === "manual" ? manualMaintenanceFields : fluigMaintenanceFields;

  return (
    <Card className="stitch-animate-in stitch-hover-lift rounded-lg shadow-none">
      <CardHeader className="space-y-3">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="size-4" />
              Tipo de nova OS
            </CardTitle>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Selecione se a ordem sera apenas da ferramenta ou se deve seguir o padrao do formulario Fluig.
            </p>
          </div>
          <Select value={flow} onValueChange={(value) => setFlow(value as "manual" | "fluig")}>
            <SelectTrigger className="w-full md:w-64">
              <SelectValue placeholder="Tipo de OS" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">OS manual da ferramenta</SelectItem>
              <SelectItem value="fluig">OS integrada ao Fluig</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={flow} onValueChange={(value) => setFlow(value as "manual" | "fluig")} className="gap-4">
          <TabsList className="grid h-auto w-full grid-cols-2">
            <TabsTrigger value="manual" className="min-h-8">
              Ferramenta
            </TabsTrigger>
            <TabsTrigger value="fluig" className="min-h-8">
              Fluig
            </TabsTrigger>
          </TabsList>
          <TabsContent value="manual" className="space-y-4">
            <FlowNotice
              title="OS manual"
              description="Nao abre processo no Fluig. O manutentor recebe no celular, atualiza status, materiais, custo e fotos diretamente na ferramenta."
            />
            <MaintenanceFieldsGrid fields={fields} />
          </TabsContent>
          <TabsContent value="fluig" className="space-y-4">
            <FlowNotice
              title="OS com Fluig"
              description="Usa o padrao do processo Fluig de ativo/manutencao e grava o retorno no registro da OS."
            />
            <MaintenanceFieldsGrid fields={fields} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function MaintenanceFieldsGrid({ fields }: { fields: MaintenanceFormField[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {fields.map((field, index) => (
        <div
          key={field.label}
          className={cn("stitch-animate-in-fast grid gap-2", field.type === "textarea" ? "md:col-span-2" : "")}
          style={{ animationDelay: `${index * 60 + 120}ms` }}
        >
          <Label>
            {field.label}
            {field.required ? <span className="ml-1 text-destructive">*</span> : null}
          </Label>
          {field.type === "textarea" ? (
            <Textarea placeholder={field.placeholder} />
          ) : field.type === "select" ? (
            <Select>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={field.placeholder} />
              </SelectTrigger>
              <SelectContent>
                {selectOptionsFor(field.label).map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : field.type === "file" ? (
            <Input type="file" multiple />
          ) : (
            <Input type={field.type === "date" ? "date" : "text"} placeholder={field.placeholder} />
          )}
        </div>
      ))}
    </div>
  );
}

function FullMaintenanceQueue({ queue }: { queue: ReturnType<typeof getMaintenanceQueue> }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="rounded-md border bg-muted/20 p-3">
        <h3 className="text-sm font-semibold">Fila mobile do manutentor</h3>
        <p className="mt-1 text-xs text-muted-foreground">Ordenada por prioridade e status operacional.</p>
        <div className="mt-3 space-y-2">
          {queue.length > 0 ? (
            queue.map((order) => (
              <div key={order.id} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{order.id}</span>
                      <PriorityBadge priority={order.priority} />
                      <StatusBadge status={order.status} />
                    </div>
                    <p className="mt-2 text-sm font-semibold">{order.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{order.area} - {order.technician}</p>
                  </div>
                  <span className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground">{order.dueAt}</span>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{order.lastUpdate}</p>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed bg-background p-6 text-center text-sm text-muted-foreground">
              Nenhuma OS real cadastrada ou sincronizada ainda.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-md border bg-muted/20">
        <header className="border-b p-3">
          <h3 className="text-sm font-semibold">Atualizacao da atividade</h3>
          <p className="text-xs text-muted-foreground">Campos que o manutentor deve responder pelo celular.</p>
        </header>
        <div className="grid gap-3 p-3 md:grid-cols-2">
          {queue.length > 0 ? (
            queue.slice(0, 3).map((order) => (
              <div key={`${order.id}-execution`} className="rounded-md border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{order.id}</p>
                    <p className="text-xs text-muted-foreground">{order.materialSummary}</p>
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <Metric label="Valor gasto" value={order.materialCost} />
                  <Metric label="Fotos" value={String(order.photos)} />
                  <Metric label="Inicio" value={order.startedAt ?? "Nao iniciado"} />
                  <Metric label="Origem" value={order.source === "manual" ? "Ferramenta" : "Fluig"} />
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-dashed bg-background p-6 text-center text-sm text-muted-foreground md:col-span-2">
              Os campos de execucao aparecerao depois que uma OS real for criada.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function CompactMaintenanceQueue({ queue }: { queue: ReturnType<typeof getMaintenanceQueue> }) {
  const visibleQueue = queue.slice(0, 3);
  return (
    <div className="space-y-2">
      {visibleQueue.length > 0 ? (
        visibleQueue.map((order) => (
          <div key={order.id} className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{order.id} - {order.title}</p>
                <p className="text-xs text-muted-foreground">{order.materialCost} em materiais - {order.photos} fotos</p>
              </div>
              <StatusBadge status={order.status} />
            </div>
          </div>
        ))
      ) : (
        <div className="rounded-md border border-dashed bg-muted/20 p-3 text-sm text-muted-foreground">
          Nenhuma OS real vinculada.
        </div>
      )}
    </div>
  );
}

function FlowNotice({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" />
        <div>
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/40 p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function selectOptionsFor(label: string) {
  if (label.includes("Prioridade")) return ["Critica", "Alta", "Media", "Baixa"];
  if (label.includes("Status")) return maintenanceMobileStatuses.map((status) => status.replaceAll("_", " "));
  if (label.includes("Tipo de transacao")) return ["Manutencao", "Transferencia", "Baixa", "Ajuste"];
  if (label.includes("Responsavel")) return ["Carlos Manutencao", "Equipe manutencao", "EasyAtivos", "Facilities"];
  if (label.includes("Area")) return ["Docas", "Camara fria", "Cobertura", "Empilhadeiras", "Administrativo"];
  if (label.includes("Filial")) return ["CD Principal", "1007 - 1007-SIA", "1062 - 1062-LUZIANIA 2"];
  return ["Opcao principal", "Opcao secundaria"];
}
