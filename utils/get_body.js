import fs from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const get_body = async (agent, prompt) => {

    const file_path = path.join(__dirname, 'bodies', `${agent}.json`);
    const file = await fs.readFile(file_path, 'utf-8');
    const raw_body_json = JSON.parse(file);

    const body_json = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    { "text": prompt }
                ]
            }
        ],
        ...raw_body_json
    }

    const body = JSON.stringify(body_json)

    return body;

}

export default get_body