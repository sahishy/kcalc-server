import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import debug_agent from "./agents/debug_agent.js";
// import test_agent from "./agents/test_agent.js";

const agent_system = async (input) => {

    const response = await debug_agent()
    return response

    // const response = await test_agent(input)
    // return response

}

//test

serve(async (req) => {
    const url = new URL(req.url);

    if(url.pathname === "/api/food") {
        try {

            const input = url.searchParams.get("name") || "";
            const response = await agent_system(input);

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