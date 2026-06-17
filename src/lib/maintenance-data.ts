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

export const maintenanceWorkOrders: MaintenanceWorkOrder[] = [
  {
    id: "OS-1042",
    source: "manual",
    title: "Porta da doca 03 travando",
    area: "Docas",
    requester: "Operacao CD",
    technician: "Carlos Manutencao",
    priority: "CRITICA",
    status: "INICIADA",
    dueAt: "Hoje 17:00",
    startedAt: "17/06 09:20",
    materialSummary: "Sensor fim de curso, parafusos M8",
    materialCost: "R$ 186,40",
    photos: 3,
    lastUpdate: "Em execucao, aguardando teste de abertura",
  },
  {
    id: "OS-1039",
    source: "manual",
    title: "Preventiva camara fria",
    area: "Camara fria",
    requester: "Facilities",
    technician: "Equipe manutencao",
    priority: "ALTA",
    status: "AGUARDANDO_MATERIAL",
    dueAt: "18/06 12:00",
    materialSummary: "Filtro, isolante termico",
    materialCost: "R$ 412,00",
    photos: 1,
    lastUpdate: "Falta filtro compativel para finalizar",
  },
  {
    id: "OS-1035",
    source: "manual",
    title: "Vazamento cobertura modulo B",
    area: "Cobertura",
    requester: "Administrativo",
    technician: "Carlos Manutencao",
    priority: "MEDIA",
    status: "ABERTA",
    dueAt: "19/06 15:00",
    materialSummary: "A definir na vistoria",
    materialCost: "R$ 0,00",
    photos: 0,
    lastUpdate: "Aguardando inicio",
  },
  {
    id: "FLG-MAN-1309",
    source: "fluig",
    title: "Solicitacao ativo fixo - equipamento doca",
    area: "Ativo fixo",
    requester: "Administrativo CD",
    technician: "EasyAtivos",
    priority: "ALTA",
    status: "AGUARDANDO_TERCEIRO",
    dueAt: "20/06 10:00",
    materialSummary: "Sem consumo local",
    materialCost: "R$ 0,00",
    photos: 2,
    lastUpdate: "Aguardando retorno do processo Fluig",
  },
];

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

const priorityRank: Record<MaintenanceWorkOrder["priority"], number> = {
  CRITICA: 0,
  ALTA: 1,
  MEDIA: 2,
  BAIXA: 3,
};

export function getMaintenanceQueue() {
  return [...maintenanceWorkOrders].sort((a, b) => {
    const byPriority = priorityRank[a.priority] - priorityRank[b.priority];
    if (byPriority !== 0) return byPriority;
    return a.id.localeCompare(b.id);
  });
}
