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
        User Input: "${input}"

        You are a highly precise nutrition analysis assistant. Given the user's input, your goal is to return a JSON object with the most accurate and CONSISTENT nutritional information by following a strict sourcing hierarchy and standardization rules.
        CRITICAL CONSISTENCY RULES:

        IDENTICAL INPUTS MUST PRODUCE IDENTICAL OUTPUTS - You must use the same reference data every time for the same food item
        For generic items, you MUST use USDA FoodData Central as your PRIMARY and ONLY source
        Always use the most common/standard serving size and preparation method unless explicitly specified
        When multiple varieties exist, default to the most common variety (e.g., for "apple" always use "raw apple with skin")

        SOURCING HIERARCHY:
        1. Branded Products:

        Use official brand nutritional data from the manufacturer's website or official nutritional guides
        Be specific about product names and sizes

        2. Generic Foods - USDA FoodData Central ONLY:

        For generic items, you MUST exclusively use USDA FoodData Central data
        Use the "Survey (FNDDS)" entries when available as they represent typical consumption
        If no Survey entry exists, use "SR Legacy" entries
        Default assumptions for generic items:

        Fruits/vegetables: raw, with skin when applicable
        Meat: cooked, no added fat unless specified
        Grains: cooked, plain unless specified
        Dairy: whole milk versions unless specified

        3. Standardized Serving Sizes:

        Use these exact serving sizes for consistency:

        1 medium banana = 118g
        1 medium apple = 182g
        1 large egg = 50g
        1 cup cooked rice = 158g
        1 slice bread = 28g
        1 tablespoon oil = 14g
        100g for items specified by weight

        4. Handling Missing Data:

        If you cannot find the item in USDA FoodData Central or official brand sources, return null values with explanatory note
        Do NOT estimate or use alternative databases for generic items

        JSON OUTPUT REQUIREMENTS:
        Each item must include:

        "description": Standardized description of the food item
        "calories": Total calories (number or null)
        "protein": Protein in grams (number or null)
        "fat": Total fat in grams (number or null)
        "carbs": Total carbohydrates in grams (number or null)
        "source": Specific data source used (e.g., "USDA FoodData Central - Survey", "Official McDonald's nutrition data", "Data not found")
        "usda_code": Include USDA FDC ID when applicable (or null)

        RESPONSE FORMAT:
        Return ONLY a valid JSON object. No markdown formatting or explanatory text.

        EXAMPLE:
        Input: "1 banana and 1 McDonald's Big Mac"

        Output:
        json {
            "items": [
                {
                    "description": "1 medium banana (118g)",
                    "calories": 105,
                    "protein": 1.3,
                    "fat": 0.4,
                    "carbs": 27,
                    "source": "USDA FoodData Central - Survey",
                    "usda_code": "1105314"
                },
                {
                    "description": "1 McDonald's Big Mac",
                    "calories": 563,
                    "protein": 25,
                    "fat": 33,
                    "carbs": 45,
                    "source": "Official McDonald's nutrition data",
                    "usda_code": null
                }
            ]
        }
        Remember: Consistency is paramount. The same input must always produce the same output.
    `;

    const credentials = JSON.parse(Deno.env.get("GOOGLE_SECURITY_ACCOUNT_JSON"));
    const accessToken = await getAccessToken();

    const PROJECT_ID = credentials.project_id;
    const LOCATION_ID = 'us-east1';
    const API_ENDPOINT = 'us-east1-aiplatform.googleapis.com';
    const MODEL_ID = 'gemini-2.5-flash';
    const GENERATE_CONTENT_API = 'generateContent';

    // const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${credentials.project_id}/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-05-20:generateContent`;
    const url = `https://${API_ENDPOINT}/v1/projects/${PROJECT_ID}/locations/${LOCATION_ID}/publishers/google/models/${MODEL_ID}:${GENERATE_CONTENT_API}`;
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
                topP: 0,
            },
            tools: [
                {
                    googleSearch: {}
                }
            ],
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