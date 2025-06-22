import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const get_url = async (agent) => {

    const credentials = JSON.parse(Deno.env.get("GOOGLE_SECURITY_ACCOUNT_JSON"));

    const file_path = path.join(__dirname, 'urls', `${agent}.json`);
    const file = await fs.readFile(file_path, 'utf-8');
    const config = JSON.parse(file);

    const url = `https://${config.api_endpoint}/v1/projects/${credentials.project_id}/locations/${config.location_id}/publishers/google/models/${config.model_id}:${config.generate_content_api}`

    return url;

}

export default get_url