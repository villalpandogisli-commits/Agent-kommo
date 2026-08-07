import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";
import { tools, runTool } from "./tools.js";
import { getConversation, saveConversation, getKnowledge } from "./supabase.js";
import { SYSTEM_PROMPT } from "./prompt.js";

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

export type Media = { base64: string; mediaType: string };

/** Construye el contenido del mensaje del cliente, con el recibo si lo mandó. */
function construirContenido(texto: string, contexto: string, media?: Media): Anthropic.ContentBlockParam[] {
  const bloques: Anthropic.ContentBlockParam[] = [];

  if (media) {
    if (media.mediaType.startsWith("image/")) {
      bloques.push({
        type: "image",
        source: {
          type: "base64",
          media_type: media.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: media.base64,
        },
      });
    } else if (media.mediaType === "application/pdf") {
      bloques.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: media.base64 },
      });
    }
  }

  bloques.push({
    type: "text",
    text:
      `Base de conocimiento:\n${contexto || "(sin datos)"}\n\n` +
      (media ? "El cliente mandó su recibo de luz (arriba). Lee los kWh bimestrales del historial de consumo.\n\n" : "") +
      `Mensaje del cliente:\n${texto || "(sin texto, solo adjunto)"}`,
  });

  return bloques;
}

/** Genera la respuesta del agente. `media` es el recibo (foto/PDF) si lo mandó. */
export async function generarRespuesta(leadId: string, texto: string, media?: Media): Promise<string> {
  const [conv, conocimiento] = await Promise.all([getConversation(leadId), getKnowledge()]);

  const mensajes = conv.history;
  mensajes.push({ role: "user", content: construirContenido(texto, conocimiento, media) });

  for (let paso = 0; paso < 5; paso++) {
    const r = await client.messages.create({
      model: config.anthropic.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages: mensajes,
    });

    mensajes.push({ role: "assistant", content: r.content });

    if (r.stop_reason === "tool_use") {
      const resultados: Anthropic.ToolResultBlockParam[] = [];
      for (const b of r.content) {
        if (b.type === "tool_use") {
          const salida = await runTool(b.name, b.input, leadId);
          resultados.push({ type: "tool_result", tool_use_id: b.id, content: salida });
        }
      }
      mensajes.push({ role: "user", content: resultados });
      continue;
    }

    const textoFinal = r.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    await saveConversation(leadId, mensajes);
    return textoFinal || "…";
  }

  await saveConversation(leadId, mensajes);
  return "Dame un momento, en seguida te atiende un asesor.";
}
