/* PlantApp — Edge Function "plant-assistant".
   Asystent AI rozmawiający o konkretnej roślinie na podstawie jej kontekstu
   (rozpoznanie, dziennik, notatki, harmonogram). Klucz Anthropic zostaje po
   stronie funkcji — nigdy w przeglądarce.

   Deploy:  supabase functions deploy plant-assistant
   Sekret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
*/
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Jesteś przyjaznym asystentem pielęgnacji roślin domowych w aplikacji PlantApp.
Odpowiadasz po polsku, zwięźle i praktycznie. Otrzymujesz kontekst JSON konkretnej rośliny:
gatunek, dziennik (podlewania, nawożenia, diagnozy, notatki), harmonogram i wskazówki pielęgnacyjne.
Opieraj porady na tym kontekście — odwołuj się do konkretnych wpisów z dziennika, gdy to pomaga.
Możesz też luźno rozmawiać o roślinie. Nie stawiasz diagnoz medycznych ani laboratoryjnych;
przy poważnych objawach sugeruj tryb "Doktor" w aplikacji. Nie używaj formatowania Markdown —
zwykły tekst, maksymalnie kilka zdań, chyba że użytkownik prosi o więcej.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userError } = await sb.auth.getUser();
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Zaloguj się, aby korzystać z asystenta." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { message, context, history } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "Brak treści wiadomości." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

    const messages: Anthropic.MessageParam[] = [];
    for (const m of Array.isArray(history) ? history.slice(-10) : []) {
      if ((m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string") {
        messages.push({ role: m.role, content: m.content });
      }
    }
    // historia z klienta zawiera już bieżące pytanie; jeśli nie — dodaj je
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      messages.push({ role: "user", content: message });
    }
    messages.unshift({
      role: "user",
      content: `Kontekst rośliny (JSON):\n${JSON.stringify(context ?? {}, null, 2)}`,
    });

    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages,
    });

    const reply = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Błąd asystenta.";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
