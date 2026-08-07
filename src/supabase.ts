import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";
import type Anthropic from "@anthropic-ai/sdk";

export const db = createClient(config.supabase.url, config.supabase.serviceKey, {
  auth: { persistSession: false },
});

// ---------- Memoria de conversación + estado (tabla: conversations) ----------

export type Conversation = {
  lead_id: string;
  history: Anthropic.MessageParam[];
  bot_paused: boolean;
};

export async function getConversation(leadId: string): Promise<Conversation> {
  const { data } = await db
    .from("conversations")
    .select("lead_id, history, bot_paused")
    .eq("lead_id", leadId)
    .maybeSingle();

  return (
    (data as Conversation | null) ?? { lead_id: leadId, history: [], bot_paused: false }
  );
}

export async function saveConversation(
  leadId: string,
  history: Anthropic.MessageParam[]
): Promise<void> {
  await db
    .from("conversations")
    .upsert({ lead_id: leadId, history, updated_at: new Date().toISOString() });
}

/** MECANISMO 3 — handoff: ¿el bot está en pausa porque un humano tomó el chat? */
export async function isBotPaused(leadId: string): Promise<boolean> {
  const { data } = await db
    .from("conversations")
    .select("bot_paused")
    .eq("lead_id", leadId)
    .maybeSingle();
  return Boolean(data?.bot_paused);
}

export async function setBotPaused(leadId: string, paused: boolean): Promise<void> {
  await db.from("conversations").upsert({ lead_id: leadId, bot_paused: paused });
}

// ---------- MECANISMO 4 — Idempotencia (tabla: processed_messages) ----------

/** Devuelve true si el mensaje YA se procesó (para no responder doble). */
export async function alreadyProcessed(messageId: string): Promise<boolean> {
  if (!messageId) return false;
  const { error } = await db.from("processed_messages").insert({ message_id: messageId });
  // Si choca con la llave primaria, ya existía => ya se procesó.
  if (error && error.code === "23505") return true;
  return false;
}

// ---------- Asignación alternada de asesor (tabla: app_state) ----------

const ASESORES = ["Ricardo", "Enrique"];

/** Devuelve el siguiente asesor alternando de forma equitativa. */
export async function nextAdvisor(): Promise<string> {
  const { data } = await db
    .from("app_state")
    .select("value")
    .eq("key", "last_advisor_index")
    .maybeSingle();

  const prev = Number(data?.value ?? -1);
  const idx = (prev + 1) % ASESORES.length;
  await db.from("app_state").upsert({ key: "last_advisor_index", value: String(idx) });
  return ASESORES[idx];
}

// ---------- Conocimiento simple (tabla: knowledge) ----------

/**
 * MVP sin embeddings: trae todas las FAQs como texto y las inyecta al prompt.
 * Sirve para un negocio con conocimiento chico/mediano. Cuando crezca,
 * migrar a búsqueda vectorial (pgvector) sin cambiar el resto.
 */
export async function getKnowledge(): Promise<string> {
  const { data } = await db.from("knowledge").select("content");
  if (!data?.length) return "";
  return data.map((r: { content: string }) => `- ${r.content}`).join("\n");
}
