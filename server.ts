import { VertexAI } from "npm:@google-cloud/vertexai";
import { GoogleAuth } from "npm:google-auth-library";
import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

const saJson = Deno.env.get("GOOGLE_SA_JSON");
if(!saJson) {
    throw new Error("GOOGLE_SA_JSON environment variable not set.");
}

const keyJson = JSON.parse(saJson);
keyJson.private_key = keyJson.private_key.replace(/\\n/g, "\n");

const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
});
const client = await auth.fromJSON(keyJson);

const vertexAI = new VertexAI({
    project: keyJson.project_id,
    location: "us-central1",
    googleAuthOverride: client,
});

const generativeModel = vertexAI.preview.getGenerativeModel({
    model: "gemini-2.5-flash-preview-05-20",
    generationConfig: {
        temperature: 0,
        maxOutputTokens: 2048,
        tools: [
            {
                googleSearch: {
                    maxResults: 3,
                },
            },
        ],
    },
});

function normalizeInput(input: string): string {
    return input
        .toLowerCase()
        .replace(/\bcups\b/g, "cup")
        .replace(/\btbsps\b/g, "tbsp")
        .replace(/\bfl oz\b/g, "fluid ounce")
        .replace(/\b(\d+)\s*\/\s*(\d+)/g, (_, a, b) =>
            (parseFloat(a) / parseFloat(b)).toFixed(2)
        )
        .replace(/\s+/g, " ")
        .trim();
}

async function getFood(input: string): Promise<string> {
    const prompt = `
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
                    "description": "3 tablespoons peanut butter",
                    "calories": 285,
                    "protein": 12,
                    "fat": 24,
                    "carbs": 9
                }
            ]
        }
    `;

    const result = await generativeModel.generateContent({
        contents: [
            {
                role: "user",
                parts: [{ text: prompt }],
            },
        ],
    });

    return result.response.candidates[0].content.parts[0].text;
}

serve(async (req: Request) => {
    const url = new URL(req.url);

    if (url.pathname === "/api/food") {
        try {
            const name = url.searchParams.get("name") || "";
            const userInput = normalizeInput(name);
            const response = await getFood(userInput);
            const items = JSON.parse(
                response.replaceAll("```", "").replaceAll("json", ""),
            ).items;

            return new Response(JSON.stringify(items), {
                headers: { "Content-Type": "application/json" },
            });
        } catch (err) {
            console.error("Error:", err);
            return new Response(
                JSON.stringify({ error: (err as Error).message }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            );
        }
    }

    return new Response("Not Found", { status: 404 });
});