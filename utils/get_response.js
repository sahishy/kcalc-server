import get_access_token from "./get_access_token.js";
import get_body from "./get_body.js";
import get_prompt from "./get_prompt.js";
import get_url from "./get_url.js";

const get_response = async (agent, input) => {

    const access_token = await get_access_token()
    const url = await get_url(agent)
    const prompt = await get_prompt(agent, input)
    const body = await get_body(agent, prompt)

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json",
        },
        body: body
    })

    const data = await response.json();

    if(!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
        console.error("Unexpected response:", JSON.stringify(data, null, 2));
        throw new Error("Invalid response from Vertex AI");
    }

    return data.candidates[0].content.parts[0].text

}

export default get_response