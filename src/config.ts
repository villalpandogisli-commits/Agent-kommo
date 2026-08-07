import "dotenv/config";

function req(name: string): string {
  const v = process.env[name];
  if (!v) console.warn(`[config] Falta la variable de entorno ${name} (revisa tu .env)`);
  return v || "";
}

export const config = {
  kommo: {
    subdomain: req("KOMMO_SUBDOMAIN"),
    accessToken: req("KOMMO_ACCESS_TOKEN"),
    webhookSecret: req("WEBHOOK_SECRET"),
    humanUserId: process.env.KOMMO_HUMAN_USER_ID || "",
    get baseUrl() {
      return `https://${this.subdomain}.kommo.com`;
    },
  },
  anthropic: {
    apiKey: req("ANTHROPIC_API_KEY"),
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
  },
  supabase: {
    url: req("SUPABASE_URL"),
    serviceKey: req("SUPABASE_SERVICE_KEY"),
  },
  port: Number(process.env.PORT || 3000),
};
