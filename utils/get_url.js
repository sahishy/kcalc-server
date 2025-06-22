import fs from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import google_security_account_json from '../google/gen-lang-client-0229403474-4ba1ea3ef123.json' with { type: 'json' }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const get_url = async (agent) => {

    const file_path = path.join(__dirname, 'urls', `${agent}.json`);
    const file = await fs.readFile(file_path, 'utf-8');
    const config = JSON.parse(file);

    const url = `https://${config.api_endpoint}/v1/projects/${google_security_account_json.project_id}/locations/${config.location_id}/publishers/google/models/${config.model_id}:${config.generate_content_api}`

    return url;

}

export default get_url