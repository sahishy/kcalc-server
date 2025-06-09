import { GoogleGenAI } from "npm:@google/genai";
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const GOOGLE_APIKEY = Deno.env.get("GOOGLE_APIKEY")!;
const ai = new GoogleGenAI({ apiKey: GOOGLE_APIKEY });

function normalizeInput(input: string): string {
    return input
        .toLowerCase()
        .replace(/\bcups\b/g, "cup")
        .replace(/\btbsps\b/g, "tbsp")
        .replace(/\bfl oz\b/g, "fluid ounce")
        .replace(/\b(\d+)\s*\/\s*(\d+)/g, (_, a, b) => (parseFloat(a) / parseFloat(b)).toFixed(2))
        .replace(/\s+/g, " ")
        .trim();
    }

async function getFood(input: string): Promise<string> {
    const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-05-20",
        contents: `

                Here is the user's input: ${input}

                You are a nutrition analysis assistant. Given the user's input describing one or more food items, return a JSON object containing an array of food items. Each item should include the **total** estimated nutritional macros based on the quantity consumed.

                Each food item should have:

                - "description": the description of the food
                - "calories": total calories for the quantity given
                - "protein": total protein in grams
                - "fat": total fat in grams
                - "carbs": total carbohydrates in grams

                Use real-world, web-sourced nutrition data. If quantity is not provided, assume a typical serving. Calculate totals accordingly.
                If a user mentions a branded product, you must estimate macros using accurate, up-to-date data from the brand's official website or trusted sources.

                Respond with ONLY valid JSON. Do NOT include markdown formatting or extra text. Here is an example input & output:

                Input:

                2 bananas and 3 tablespoons peanut butter

                Output:

                {
                    "items": [
                        {
                            "description": "2 bananas",
                            "calories": 210,
                            "protein": 2.6,
                            "fat": 0.8,
                            "carbs": 54
                        },
                        {
                            "name": "3 tablespoons peanut butter",
                            "calories": 285,
                            "protein": 12,
                            "fat": 24,
                            "carbs": 9
                        }
                    ]
                }
            `,
            config: {
            temperature: 0,
            thinkingConfig: {
                thinkingBudget: 0,
            },
            tools: [{googleSearch: {}}],
        },
    });

    return response.text;
}

serve(async (req: Request) => {

    const url = new URL(req.url);

    if(url.pathname === "/api/food") {

        try {

            const name = url.searchParams.get("name") || "";
            const userInput = normalizeInput(name);
            const response = await getFood(userInput);
            const items = JSON.parse(response.replaceAll("```", "").replaceAll("json", "")).items;

            return new Response(JSON.stringify(items), {
                headers: { "Content-Type": "application/json" },
            });

        } catch (err) {

            console.error("Error:", err);

            return new Response(JSON.stringify({ error: (err as Error).message }), {
                status: 500,
                headers: { "Content-Type": "application/json" },
            });

        }
    }

    return new Response("Not Found", { status: 404 });
});