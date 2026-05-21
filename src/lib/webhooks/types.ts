/**
 * Tipos do payload de webhook da VIS Platform.
 *
 * O payload chega como JSON arbitrário — todos os campos são opcionais aqui e
 * o handler acessa de forma defensiva. Ver WEBHOOK_CONTRACT.md seção 5.
 */
export interface VisWebhookProduct {
  id?: number;
  name?: string;
  quantity?: number;
  price?: number;
}

export interface VisWebhookCustomer {
  name?: string;
  email?: string;
  phone?: string;
  cpf?: string;
}

export interface VisWebhookTracking {
  src?: string | null;
  sck?: string | null;
  [key: string]: unknown;
}

export interface VisWebhookData {
  order_id?: number;
  uuid?: string;
  status?: string;
  payment_id?: string;
  payment_method?: string;
  payment_gateway?: string;
  total?: number;
  subtotal?: number;
  discount?: number;
  customer?: VisWebhookCustomer;
  products?: VisWebhookProduct[];
  tracking?: VisWebhookTracking;
  created_at?: string;
  paid_at?: string;
  refunded_at?: string | null;
  [key: string]: unknown;
}

export interface VisWebhookPayload {
  event?: string;
  test?: boolean;
  timestamp?: string;
  data?: VisWebhookData;
  [key: string]: unknown;
}

/** Type guard: o JSON parseado tem o shape mínimo de um payload da VIS. */
export function isVisWebhookPayload(value: unknown): value is VisWebhookPayload {
  return typeof value === "object" && value !== null;
}
