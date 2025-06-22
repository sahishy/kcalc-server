import fs from 'fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const get_prompt = async (agent, input) => {

    const file_path = path.join(__dirname, 'prompts', `${agent}.txt`);

    try {

        const final = [`--- User input: ${input} ---`]

        const data = await fs.readFile(file_path, 'utf8');
        final.push(data)

        return final.join('\n\n')

    } catch (err) {

        return `error: ${err}`

    }
}

export default get_prompt