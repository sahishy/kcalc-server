import { serve } from "https://deno.land/std@0.203.0/http/server.ts";

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
        Here is the user's input: ${input}

        You are a nutrition analysis assistant. Given the user's input describing one or more food items,
        return a JSON object containing an array of food items. Each item should include the **total** estimated nutritional macros based on the quantity consumed.

        Each food item should have:

        - "description": the description of the food
        - "calories": total calories for the quantity given
        - "protein": total protein in grams
        - "fat": total fat in grams
        - "carbs": total carbohydrates in grams

        Use real-world, web-sourced nutrition data. If quantity is not provided, assume a typical serving. Calculate totals accordingly.
        Only use information from the top results when searching Google.
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

    const credentials = JSON.parse(Deno.env.get("GOOGLE_SECURITY_ACCOUNT_JSON"));
    const accessToken = await getAccessToken();

    // const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${credentials.project_id}/locations/us-central1/publishers/google/models/gemini-2.5-flash-preview-05-20:generateContent`;
    const url = `https://us-central1-aiplatform.googleapis.com/v1/projects/${credentials.project_id}/locations/us-central1/publishers/google/models/gemini-2.0-flash-001:generateContent`;
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
                topP: 1
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