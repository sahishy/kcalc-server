import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

function normalizeInput(input) {
    const unitMap = {
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

    function base64url(input) {
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

    function str2ab(str) {
        const binaryString = atob(str.split('\n').filter(l => !l.includes("PRIVATE KEY")).join(""));
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    }
}

async function getFood(input) {
    const prompt = `
        You are a highly precise nutrition analysis assistant. Given the user's input, your goal is to return a JSON object with the most accurate and consistent nutritional information possible by following a strict sourcing hierarchy.

        Here is the user's input: ${input}

        You MUST adhere to the following sourcing hierarchy to find the data for EACH item:

        **1. Branded Products First:**
        - If an item is a specific branded product (e.g., 'McDonald's Chicken McGriddle', 'Ben & Jerry's Cherry Garcia', 'Starbucks Grande Latte'), you MUST prioritize finding the official nutritional information directly from the brand's official website or their published nutritional data.
        - Your search should be targeted to find this official data.

        **2. Generic Foods from Reputable Databases:**
        - If an item is generic (e.g., 'banana', 'cooked chicken breast', 'quinoa'), you should retrieve the data from a major, reputable nutritional database. Trustworthy options include USDA FoodData Central, Nutritionix, or Open Food Facts.
        - For a generic item, use the most common or standard entry.

        **3. Handling Failure to Find Data:**
        - If, after a thorough search following the hierarchy above, you absolutely cannot find a reliable source for a specific item, you MUST return the item with 'null' for the nutritional values and add a descriptive note.
        - Do NOT estimate or guess the nutritional values if a reliable source is not found.

        **JSON Output Requirements:**
        - Each food item in the JSON array must have:
        - "description": The description of the food.
        - "calories": Total calories (number).
        - "protein": Total protein in grams (number).
        - "fat": Total fat in grams (number).
        - "carbs": Total carbohydrates in grams (number).
        - "notes": A brief note on the data source (e.g., "From official McDonald's website.", "Generic data from USDA.", "Could not find a reliable source.").

        Respond with ONLY a single, valid JSON object. Do NOT include markdown formatting or any explanatory text outside of the JSON.

        ---

        **EXAMPLE (For Formatting and Logic Reference Only):**

        *NOTE: This example is to show the required JSON output format and the sourcing logic in action. Do not use these exact values for the user's input. The AI should find the values for the user's actual query.*

        **Example Input:**

        '1 chicken mcgriddle and a banana'

        **Example Output:**

        json
        {
            "items": [
                {
                    "description": "1 chicken mcgriddle",
                    "calories": 380,
                    "protein": 14,
                    "fat": 14,
                    "carbs": 50,
                    "notes": "Data from official McDonald's website."
                },
                {
                    "description": "1 banana",
                    "calories": 105,
                    "protein": 1.3,
                    "fat": 0.4,
                    "carbs": 27,
                    "notes": "Generic data from reputable nutrition database."
                }
            ]
        }
    `;

    const credentials = JSON.parse(Deno.env.get("GOOGLE_SECURITY_ACCOUNT_JSON"));
    const accessToken = await getAccessToken();

    const PROJECT_ID = credentials.project_id;
    const LOCATION_ID = 'global';
    const API_ENDPOINT = 'aiplatform.googleapis.com';
    const MODEL_ID = 'gemini-2.5-flash-lite-preview-06-17';
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


serve(async (req) => {
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
                JSON.stringify({ error: err.message }),
                {
                    status: 500,
                    headers: { "Content-Type": "application/json" },
                },
            );

        }
    }

    return new Response("Not Found", { status: 404 });
});