import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// Cargar .env desde la raíz del proyecto
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

export const config = {
    ollamaHost: process.env.OLLAMA_HOST || '127.0.0.1:11434',
    currentModel: process.env.OLLAMA_MODEL || 'qwen3.5:4b',
    projectRoot: PROJECT_ROOT,
    skillsDir: path.join(PROJECT_ROOT, 'skills'),
    
    // Método para cambiar el modelo activo en tiempo real
    setModel(newModel) {
        if (newModel && typeof newModel === 'string') {
            this.currentModel = newModel.trim();
            console.log(`[Config] Modelo cambiado a: ${this.currentModel}`);
        }
    }
};
