Deno.serve(async (req: Request) => {
    const url = new URL(req.url);
    const input = url.searchParams.get("name");

    if(!input) {
        return new Response(JSON.stringify({ error: "Missing 'name' query parameter" }), {
            headers: { "Content-Type": "application/json" },
            status: 400,
        });
    }

    const normalizedInput = input
        .toLowerCase()
        .replace(/\bcups\b/g, "cup")
        .replace(/\btbsps\b/g, "tbsp")
        .replace(/\bfl oz\b/g, "fluid ounce")
        .replace(/\b(\d+)\s*\/\s*(\d+)/g, (_, a, b) => (parseFloat(a) / parseFloat(b)).toFixed(2))
        .replace(/\s+/g, " ")
        .trim();

    const apiKey = Deno.env.get("GOOGLE_APIKEY");
    if(!apiKey) {
        return new Response(JSON.stringify({ error: "Missing GOOGLE_APIKEY" }), {
            headers: { "Content-Type": "application/json" },
            status: 500,
        });
    }

    console.log(apiKey)

    const body = {
        contents: [
        {
            parts: [
            {
                text: `
                You are a nutrition analysis assistant. Given the user's input describing one or more food items, return a JSON object containing an array of food items. Each item should include the **total** estimated nutritional macros based on the quantity consumed.

                Each food item should have:
                - "description": the description of the food
                - "calories": total calories for the quantity given
                - "protein": total protein in grams
                - "fat": total fat in grams
                - "carbs": total carbohydrates in grams

                Use real-world, web-sourced nutrition data. If quantity is not provided, assume a typical serving. Calculate totals accordingly.

                Respond with ONLY valid JSON. Input: ${normalizedInput}
                `,
            },
            ],
        },
        ],
    };

    const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${apiKey}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        },
    );

    const result = await geminiResponse.json();

    console.log(JSON.stringify(result))

    const raw = result?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const json = JSON.parse(raw.replaceAll("```", "").replaceAll("json", ""));

    return new Response(JSON.stringify(json.items || []), {
        headers: { "Content-Type": "application/json" },
    });
});