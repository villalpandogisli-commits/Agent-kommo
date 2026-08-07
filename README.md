# Rayo — Agente WhatsApp de Gisli Prime Services (Kommo + Supabase + Claude)

Agente de WhatsApp ("Rayo") que precalifica clientes de paneles solares, lee su recibo de luz,
da un aproximado de paneles y agenda videollamada con asesor. Setup mínimo:
**Kommo** (canal WhatsApp + CRM), **Supabase** (memoria/estado/conocimiento), **Claude** (cerebro).

## Flujo

```
Cliente → WhatsApp → Kommo (canal + CRM)
   → Salesbot (paso widget_request) → POST /kommo/webhook (este backend)
        → responde 200 en < 2s
        → en segundo plano: descarga recibo (si lo mandó) + Supabase + Claude
        → resumeSalesbot(return_url, respuesta)
   → Kommo muestra la respuesta en WhatsApp
```

## Lo que implementa del prompt de Rayo

- **Persona y reglas** completas en `src/prompt.ts` (tono, qué obtener, cómo conduce, precios, FAQs, límites).
- **Cálculo de paneles determinístico** (`calcular_paneles`, en `src/tools.ts`): regla oficial `ceil(kWh/150)`, paneles 630W. Probado contra las 48 filas de la tabla oficial. Maneja límites: <250 kWh (no da número) y >7,500 kWh (pasa al asesor). El modelo NO calcula de cabeza.
- **Lectura del recibo por visión** (`src/agent.ts` + `downloadMedia` en `src/kommo.ts`): si el cliente manda foto o PDF, se descarga y se le pasa a Claude para extraer los kWh del historial de consumo.
- **Asignación alternada de asesor** (`asignar_asesor`): Ricardo/Enrique equitativo, con estado en Supabase (`app_state`).
- **Escalado a humano** (`escalar_a_humano`): pausa el bot y asigna el lead.

## Los 5 mecanismos anti-trabas

1. **Responder rápido / procesar después** — `src/index.ts`.
2. **Candado por contacto** — `src/lock.ts` (serializa por `lead_id`).
3. **Pausa por handoff** — `bot_paused` en Supabase.
4. **Idempotencia** — `alreadyProcessed` en Supabase.
5. **Fallback** — catch en `src/index.ts`.

## Archivos

| Archivo | Qué hace |
|---|---|
| `src/prompt.ts` | System prompt de Rayo (edítalo para afinar el tono). |
| `src/index.ts` | Webhook de Kommo + los 5 mecanismos + descarga del recibo. |
| `src/agent.ts` | Claude: prompt + memoria + tool use + visión del recibo. |
| `src/tools.ts` | `calcular_paneles`, `asignar_asesor`, `guardar_datos_lead`, `escalar_a_humano`. |
| `src/kommo.ts` | Parsear widget_request, reanudar Salesbot, descargar adjunto, actualizar/asignar lead. |
| `src/supabase.ts` | Memoria, pausa, idempotencia, asignación de asesor, conocimiento. |
| `src/lock.ts` | Candado por contacto. |
| `supabase/schema.sql` | Tablas + FAQs/datos de Gisli, listo para correr. |

## Puesta en marcha

1. **Supabase:** crea el proyecto, corre `supabase/schema.sql`, copia URL + Service Role key al `.env`.
2. **Kommo:** conecta WhatsApp Business; crea integración privada (access token); arma un Salesbot con un paso **widget_request** a `https://TU-BACKEND/kommo/webhook?secret=...` que mande `{ "message": "{{message.text}}", "lead_id": "{{lead.id}}", "message_id": "{{message.id}}", "media_url": "{{message.attachment.url}}" }`, y un paso "Enviar mensaje" con la respuesta del backend.
3. **Backend:** `npm install`, llena `.env`, `npm run dev`, túnel (ngrok) para pruebas.

## TODOs para producción

- Mapear los datos del cliente (celular, ciudad, kWh, tiempo, cita) a campos personalizados de Kommo en `tools.ts` (`custom_fields_values`).
- Confirmar el payload exacto de `return_url` y el placeholder del adjunto contra developers.kommo.com/docs/salesbot-dp.
- Enviar la liga de la videollamada al correo del cliente al agendar (Google Calendar / Meet o el sistema que usen).
- Reactivar el bot (`bot_paused = false`) cuando el humano cierra su intervención.
- Verificar la firma del webhook y, si escalas a varias instancias, mover el candado a Supabase/Redis.
