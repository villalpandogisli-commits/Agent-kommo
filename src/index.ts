import express from "express";
import { config } from "./config.js";
import { parseWidgetRequest, resumeSalesbot, downloadMedia } from "./kommo.js";
import { generarRespuesta } from "./agent.js";
import { withLock } from "./lock.js";
import { alreadyProcessed, isBotPaused } from "./supabase.js";

const app = express();
app.use(express.json());

app.post("/kommo/webhook", async (req, res) => {
  // Seguridad simple: valida un secreto compartido (?secret=... o header).
  const secret = req.query.secret ?? req.header("x-webhook-secret");
  if (config.kommo.webhookSecret && secret !== config.kommo.webhookSecret) {
    return res.sendStatus(403);
  }

  const wr = parseWidgetRequest(req.body);
  if (!wr) return res.sendStatus(200); // nada que procesar

  // MECANISMO 1 — responder rápido (Kommo exige 200 en < 2s).
  res.sendStatus(200);

  // Procesamiento en segundo plano, serializado por lead (MECANISMO 2).
  withLock(wr.leadId, async () => {
    try {
      // MECANISMO 4 — idempotencia: no procesar dos veces el mismo mensaje.
      if (await alreadyProcessed(wr.messageId)) return;

      // MECANISMO 3 — si un humano tomó el chat, el bot no responde.
      if (await isBotPaused(wr.leadId)) return;

      // Si mandó recibo (foto/PDF), lo descargamos para que Claude lo lea.
      const media = wr.mediaUrl ? (await downloadMedia(wr.mediaUrl)) ?? undefined : undefined;

      const respuesta = await generarRespuesta(wr.leadId, wr.text, media);
      await resumeSalesbot(wr.returnUrl, respuesta); // reanuda el bot y muestra la respuesta
      console.log(`[ok] lead ${wr.leadId}: ${respuesta}`);
    } catch (err) {
      // MECANISMO 5 — fallback: no dejar la conversación colgada.
      console.error(`[error] lead ${wr.leadId}:`, err);
      await resumeSalesbot(
        wr.returnUrl,
        "Dame un momento, en seguida te atiende un asesor."
      ).catch(() => {});
    }
  });
});

app.get("/", (_req, res) => res.send("WhatsApp Agent (Kommo) OK"));

app.listen(config.port, () => console.log(`Servidor en http://localhost:${config.port}`));
