export type MaintenanceOrderSource = "manual" | "fluig";

export type MaintenanceWorkOrder = {
  id: string;
  source: MaintenanceOrderSource;
  title: string;
  area: string;
  requester: string;
  technician: string;
  priority: "CRITICA" | "ALTA" | "MEDIA" | "BAIXA";
  status: "ABERTA" | "INICIADA" | "AGUARDANDO_MATERIAL" | "AGUARDANDO_TERCEIRO" | "FINALIZADA";
  dueAt: string;
  startedAt?: string;
  materialSummary: string;
  materialCost: string;
  photos: number;
  lastUpdate: string;
};

export type MaintenanceFormField = {
  label: string;
  type: "text" | "textarea" | "select" | "money" | "date" | "file";
  placeholder: string;
  required?: boolean;
};

export const manualMaintenanceFields: MaintenanceFormField[] = [
  { label: "Area do CD", type: "select", placeholder: "Docas, camara fria, cobertura, empilhadeiras", required: true },
  { label: "Prioridade", type: "select", placeholder: "Critica, alta, media ou baixa", required: true },
  { label: "Solicitante", type: "text", placeholder: "Quem abriu a demanda", required: true },
  { label: "Responsavel manutencao", type: "select", placeholder: "Tecnico ou equipe responsavel", required: true },
  { label: "Descricao da OS", type: "textarea", placeholder: "Problema, local exato e impacto operacional", required: true },
  { label: "Material utilizado", type: "textarea", placeholder: "Produto, quantidade e unidade usada" },
  { label: "Valor gasto", type: "money", placeholder: "R$ 0,00" },
  { label: "Fotos da execucao", type: "file", placeholder: "Antes, durante e depois" },
  { label: "Status inicial", type: "select", placeholder: "Aberta ou iniciada" },
  { label: "Motivo se nao finalizar", type: "textarea", placeholder: "Aguardando material, fornecedor, acesso ou aprovacao" },
];

export const fluigMaintenanceFields: MaintenanceFormField[] = [
  { label: "Tipo de transacao Fluig", type: "select", placeholder: "Manutencao, transferencia, baixa ou ajuste", required: true },
  { label: "Codigo do patrimonio", type: "text", placeholder: "Tag do ativo quando houver" },
  { label: "Filial origem", type: "select", placeholder: "Filial/area de origem", required: true },
  { label: "Filial destino", type: "select", placeholder: "Obrigatorio para transferencia" },
  { label: "Responsavel Fluig", type: "select", placeholder: "ZoomDemandaPara / grupo de atendimento", required: true },
  { label: "Observacao fiscal", type: "textarea", placeholder: "Descricao que sera enviada ao processo Fluig", required: true },
  { label: "Anexos para Fluig", type: "file", placeholder: "Fotos, nota, laudo ou evidencia" },
];

export const maintenanceMobileStatuses = [
  "ABERTA",
  "INICIADA",
  "AGUARDANDO_MATERIAL",
  "AGUARDANDO_TERCEIRO",
  "FINALIZADA",
];

export function getMaintenanceQueue() {
  return [] as MaintenanceWorkOrder[];
}
