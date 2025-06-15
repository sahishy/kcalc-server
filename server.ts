import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

function normalizeInput(input: string): string {
    const unitMap: Record<string, string> = {
        g: "gram", gram: "gram", grams: "gram",
        kg: "kilogram", kgs: "kilogram", kilograms: "kilogram",
        ml: "milliliter", milliliters: "milliliter",
        l: "liter", liters: "liter",
        lb: "pound", lbs: "pound", pounds: "pound",
        oz: "ounce", ounces: "ounce",
        "fl oz": "fluid ounce", "fluid ounces": "fluid ounce",
        tsp: "teaspoon", tsps: "teaspoon", teaspoons: "teaspoon",
        tbsp: "tablespoon", tbsps: "tablespoon", tablespoons: "tablespoon",
        cup: "cup", cups: "cup",
    };

    input = input.toLowerCase();

    const units = Object.keys(unitMap)
        .sort((a, b) => b.length - a.length)
        .map(u => u.replace(/ /g, "\\s+"))
        .join("|");

    const noOfRegex = new RegExp(
        `(\\d+(?:\\.\\d+)?)(?:\\s*)(${units})\\s+(?!of\\b)([a-z][a-z ]*?)(?=[,]|$)`,
        "gi"
    );
    input = input.replace(noOfRegex, (_, qty, rawUnit, item) => {
        const normUnit = unitMap[rawUnit.replace(/\s+/g, " ")] || rawUnit;
        const pluralUnit = parseFloat(qty) !== 1 ? normUnit + "s" : normUnit;
        return `${qty} ${pluralUnit} of ${item.trim()}`;
    });

    const withOfRegex = new RegExp(
        `(\\d+(?:\\.\\d+)?)(?:\\s*)(${units})(\\s+of\\s+[a-z][a-z ]*?)(?=[,]|$)`,
        "gi"
    );
    input = input.replace(withOfRegex, (_, qty, rawUnit, rest) => {
        const normUnit = unitMap[rawUnit.replace(/\s+/g, " ")] || rawUnit;
        const pluralUnit = parseFloat(qty) !== 1 ? normUnit + "s" : normUnit;
        return `${qty} ${pluralUnit}${rest}`;
    });

    input = input.replace(/\b(\d+)\s*\/\s*(\d+)\b/g, (_, a, b) =>
        (parseFloat(a) / parseFloat(b)).toFixed(2)
    );
    input = input.replace(/\b(\d+)\s*(?:-|\sto\s)\s*(\d+)\b/g, (_, a) => a);

    return input.replace(/\s+/g, " ").trim();
}


async function getAccessToken() {
    const credentials = JSON.parse(Deno.env.get("GOOGLE_SECURITY_ACCOUNT_JSON"));

    const header = {
        alg: "RS256",
        typ: "JWT",
    };

    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + 3600;

    const payload = {
        iss: credentials.client_email,
        scope: "https://www.googleapis.com/auth/cloud-platform",
        aud: "https://oauth2.googleapis.com/token",
        exp,
        iat,
    };

    function base64url(input: any) {
        return btoa(Array.from(new Uint8Array(input), byte => String.fromCharCode(byte)).join(""))
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }

    const encoder = new TextEncoder();
    const toSign = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(encoder.encode(JSON.stringify(payload)))}`;

    const key = await crypto.subtle.importKey(
        "pkcs8",
        str2ab(credentials.private_key),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
    );

    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(toSign));
    const jwt = `${toSign}.${base64url(signature)}`;

    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: jwt,
        }),
    });

    const data = await res.json();
    return data.access_token;

    function str2ab(str: string) {
        const binaryString = atob(str.split('\n').filter(l => !l.includes("PRIVATE KEY")).join(""));
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

async function getFood(input: string) {
    const prompt = `
        You are a nutrition analysis assistant. Your sole task is to provide nutritional information for the food items described in the user's input. You MUST use the USDA FoodData Central (https://fdc.nal.usda.gov/) as your ONLY source of information.

        Here is the user's input: ${input}

        Your process is as follows:
        1.  For each food item in the user's input, perform a search on the USDA FoodData Central website.
        2.  Use the most relevant and generic entry for the food item unless a specific brand is mentioned. For "cooked chicken," you should look for a generic entry for cooked chicken.
        3.  If you find a matching food item, extract the nutritional information for the specified quantity. The key nutrients to extract are:
            * Energy (kcal) - report this as "calories"
            * Protein (g)
            * Total lipid (fat) (g) - report this as "fat"
            * Carbohydrate, by difference (g) - report this as "carbs"
        4.  If the user provides a quantity in grams or another unit, you must calculate the total nutritional values for that quantity based on the per-100g data from the USDA FoodData Central.
        5.  If a user-provided food item cannot be found in the USDA FoodData Central, you MUST return an error for that specific item, clearly stating that the food was not found. Do not estimate or use information from any other source.
        6.  Return the final output as a single, valid JSON object. Do not include any text or markdown formatting outside of the JSON object.

        Input:
        200g of cooked chicken and 1 large apple

        Output:
        {
            "items": [
                {
                    "description": "200g of cooked chicken",
                    "calories": 334,
                    "protein": 62.58,
                    "fat": 7.72,
                    "carbs": 0
                },
                {
                    "description": "1 large apple",
                    "calories": 116,
                    "protein": 0.58,
                    "fat": 0.38,
                    "carbs": 30.98
                }
            ]
        }
    `;

    const credentials = JSON.parse(Deno.env.get("GOOGLE_SECURITY_ACCOUNT_JSON"));
    const accessToken = await getAccessToken();

    // const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${credentials.project_id}/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-05-20:generateContent`;
    const url = `https://us-east4-aiplatform.googleapis.com/v1/projects/${credentials.project_id}/locations/us-east4/publishers/google/models/gemini-2.0-flash-001:generateContent`;
    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${accessToken}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            contents: [
                {
                    role: "user",
                    parts: [
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: {
                maxOutputTokens: 1024,
                temperature: 0,
                topP: 0
            },
            tools: [
                {
                    googleSearch: {}
                }
            ]
        }),
    });

    const data = await response.json();

    if(!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
        console.error("Unexpected response:", JSON.stringify(data, null, 2));
        throw new Error("Invalid response from Vertex AI");
    }

    return data.candidates[0].content.parts[0].text;
}


serve(async (req: Request) => {
    const url = new URL(req.url);

    if(url.pathname === "/api/food") {
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

        } catch(err) {

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