import path from 'node:path'
import { fileURLToPath } from 'node:url';
import get_prompt from '../utils/get_prompt.js';
import get_url from '../utils/get_url.js';
import get_body from '../utils/get_body.js';
import get_response from '../utils/get_response.js';

const agent = fileURLToPath(import.meta.url).split(path.dirname(fileURLToPath(import.meta.url))+'/').pop().split('.')[0];

const input_parser_agent = async (input) => {

    const url = await get_url(agent)

    const prompt = await get_prompt(agent, input)
    const body = await get_body(agent, prompt)

    const response = await get_response(url, body)

    return response
    
}

export default input_parser_agent