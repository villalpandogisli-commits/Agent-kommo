import { config } from "./config.js";

/**
 * Datos que sacamos del webhook `widget_request` del Salesbot de Kommo.
 * Ajusta los nombres de campo según cómo configures el paso en Kommo:
 * en el paso widget_request mandas, por ejemplo,
 *   { "message": "{{message.text}}", "lead_id": "{{lead.id}}", "message_id": "{{message.id}}" }
 */
export type WidgetRequest = {
  leadId: string;
  messageId: string;
  text: string;
  returnUrl: string;
  // Recibo de luz (foto o PDF), si el cliente lo mandó como adjunto.
  mediaUrl?: string;
  mediaType?: string; // ej. "image/jpeg" | "application/pdf"
};

export function parseWidgetRequest(body: any): WidgetRequest | null {
  const data = body?.data ?? body ?? {};
  const leadId = String(data.lead_id ?? data.leadId ?? "");
  const returnUrl = String(body?.return_url ?? data.return_url ?? "");
  const text = String(data.message ?? data.message_text ?? "");
  const messageId = String(data.message_id ?? "");
  const mediaUrl = data.media_url || data.attachment_url || data.file_url || undefined;
  const mediaType = data.media_type || data.file_type || undefined;
  if (!leadId || !returnUrl) return null;
  return { leadId, messageId, text, returnUrl, mediaUrl, mediaType };
}

/** Descarga un adjunto (recibo) y lo devuelve en base64 para pasárselo a Claude. */
export async function downloadMedia(
  url: string
): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${config.kommo.accessToken}` },
    });
    if (!res.ok) return null;
    const mediaType = res.headers.get("content-type") || "application/octet-stream";
    const buf = Buffer.from(await res.arrayBuffer());
    return { base64: buf.toString("base64"), mediaType };
  } catch (e) {
    console.error("[kommo] Error descargando adjunto:", e);
    return null;
  }
}

/**
 * MECANISMO 1 — reanudar el Salesbot.
 * Después de procesar (Claude), llamamos a la return_url para que el bot siga.
 * Usamos execute_handlers con el handler `show`, que envía el texto directo al
 * chat de WhatsApp (no hace falta un paso extra "Enviar mensaje" en el Salesbot).
 * Ref: developers.kommo.com/docs/private-chatbot-integration
 */
export async function resumeSalesbot(returnUrl: string, reply: string): Promise<void> {
  const res = await fetch(returnUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.kommo.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      data: { reply },
      execute_handlers: [{ handler: "show", params: { type: "text", value: reply } }],
    }),
  });
  if (!res.ok) {
    console.error(`[kommo] Error reanudando Salesbot: ${res.status} ${await res.text()}`);
  }
}

/** Actualiza campos de un lead en Kommo (para guardar datos calificados). */
export async function updateLead(leadId: string, fields: Record<string, unknown>): Promise<void> {
  const url = `${config.kommo.baseUrl}/api/v4/leads/${leadId}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${config.kommo.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) console.error(`[kommo] Error actualizando lead: ${res.status}`);
}

/** Asigna el lead a un humano (parte del handoff). */
export async function assignToHuman(leadId: string): Promise<void> {
  if (!config.kommo.humanUserId) return;
  await updateLead(leadId, { responsible_user_id: Number(config.kommo.humanUserId) });
}
