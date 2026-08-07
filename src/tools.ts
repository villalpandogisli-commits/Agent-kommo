import type Anthropic from "@anthropic-ai/sdk";
import { updateLead, assignToHuman } from "./kommo.js";
import { setBotPaused, nextAdvisor } from "./supabase.js";

// ---------------- Lógica determinística de cálculo de paneles ----------------

export type CalculoPaneles =
  | { tipo: "ok"; paneles: number; kwh: number }
  | { tipo: "bajo"; kwh: number }
  | { tipo: "grande"; kwh: number };

/**
 * Regla oficial de Gisli: paneles de 630W, número = ceil(kWh bimestral / 150).
 * Reproduce exactamente la tabla oficial (250–7,500 kWh).
 * Límites: < 250 kWh no se da número; > 7,500 kWh se pasa al asesor.
 */
export function calcularPaneles(kwh: number): CalculoPaneles {
  if (!Number.isFinite(kwh) || kwh < 250) return { tipo: "bajo", kwh };
  if (kwh > 7500) return { tipo: "grande", kwh };
  return { tipo: "ok", paneles: Math.ceil(kwh / 150), kwh };
}

// ---------------- Definición de herramientas para Claude ----------------

export const tools: Anthropic.Tool[] = [
  {
    name: "calcular_paneles",
    description:
      "Devuelve el número aproximado de paneles (630W) a partir del consumo bimestral en kWh " +
      "sacado del recibo. Úsala SIEMPRE en vez de calcular tú; maneja los límites (<250 y >7500).",
    input_schema: {
      type: "object",
      properties: {
        kwh_bimestral: { type: "number", description: "Consumo bimestral en kWh, tomado del recibo" },
      },
      required: ["kwh_bimestral"],
    },
  },
  {
    name: "asignar_asesor",
    description:
      "Asigna el siguiente asesor de forma alternada (Ricardo/Enrique). Úsala al momento de agendar.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "guardar_datos_lead",
    description:
      "Guarda en el lead de Kommo los datos que hayas obtenido del cliente. Llámala cuando tengas datos nuevos.",
    input_schema: {
      type: "object",
      properties: {
        nombre: { type: "string" },
        celular: { type: "string" },
        ciudad: { type: "string" },
        tipo_inmueble: { type: "string", description: "casa o negocio" },
        dueno_o_renta: { type: "string", description: "dueño o renta" },
        kwh_bimestral: { type: "number" },
        tiempo_instalacion: { type: "string", description: "3 meses / 6 meses / más de un año" },
        recibo_recibido: { type: "boolean" },
        asesor: { type: "string" },
        dia_hora_cita: { type: "string" },
      },
    },
  },
  {
    name: "escalar_a_humano",
    description:
      "Pasa la conversación a un humano del equipo (cliente instalado con falla/queja, facturas/pagos, " +
      "proyecto industrial/licitación, o cliente molesto). Después de esto el bot deja de responder.",
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string" },
        resumen: { type: "string", description: "Resumen breve para el equipo" },
      },
      required: ["motivo"],
    },
  },
];

// ---------------- Ejecución ----------------

export async function runTool(name: string, input: any, leadId: string): Promise<string> {
  switch (name) {
    case "calcular_paneles": {
      const r = calcularPaneles(Number(input.kwh_bimestral));
      if (r.tipo === "bajo")
        return "CONSUMO BAJO (<250 kWh): no des un número de paneles. Di que el consumo es bajo y que el asesor revisa si conviene o no.";
      if (r.tipo === "grande")
        return "PROYECTO GRANDE (>7500 kWh): no des un número. Es un proyecto grande, pásalo directo al asesor.";
      return `Paneles aproximados: ${r.paneles}. Recuerda decir SIEMPRE el disclaimer de que es aproximado y que el asesor lo confirma en la sesión.`;
    }

    case "asignar_asesor": {
      const asesor = await nextAdvisor();
      return `Asesor asignado: ${asesor}.`;
    }

    case "guardar_datos_lead": {
      const fields: Record<string, unknown> = {};
      if (input.nombre) fields.name = input.nombre;
      // Los demás datos suelen ir a campos personalizados de Kommo (custom_fields_values).
      // TODO: mapear celular/ciudad/kwh/etc. a los IDs de tus campos personalizados.
      if (Object.keys(fields).length) await updateLead(leadId, fields);
      console.log("[tool] guardar_datos_lead:", input);
      return "Datos guardados en el lead.";
    }

    case "escalar_a_humano": {
      console.log("[tool] escalar_a_humano:", input);
      await setBotPaused(leadId, true);
      await assignToHuman(leadId);
      return "Escalado. El equipo continuará la conversación.";
    }

    default:
      return `Herramienta desconocida: ${name}`;
  }
}
