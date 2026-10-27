import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { app } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// Cargar .env de desarrollo si existe
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

// Directorio seguro de persistencia de usuario
function obtenerRutaConfigUsuario() {
    try {
        if (app && app.getPath) {
            const userDataPath = app.getPath('userData');
            return path.join(userDataPath, 'config.json');
        }
    } catch {}
    return path.join(PROJECT_ROOT, '.user-config.json');
}

const CONFIG_PATH = obtenerRutaConfigUsuario();

function cargarConfigGuardada() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.warn('[Config] Error leyendo config de usuario:', e.message);
    }
    return {};
}

const configGuardada = cargarConfigGuardada();

export const config = {
    // Prioridad: 1. Guardado en app por el usuario, 2. .env, 3. Vacío para forzar Setup
    ollamaHost: configGuardada.ollamaHost || process.env.OLLAMA_HOST || '',
    currentModel: configGuardada.currentModel || process.env.OLLAMA_MODEL || '',
    projectRoot: PROJECT_ROOT,
    skillsDir: path.join(PROJECT_ROOT, 'skills'),

    guardarConfig({ host, model }) {
        if (host !== undefined) {
            // Normalizar host: quitar http:// o trailing slashes si el usuario los escribió
            let cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
            if (!cleanHost.includes(':')) {
                cleanHost += ':11434'; // Puerto predeterminado de Ollama
            }
            this.ollamaHost = cleanHost;
        }

        if (model !== undefined) {
            this.currentModel = model.trim();
        }

        try {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            
            fs.writeFileSync(CONFIG_PATH, JSON.stringify({
                ollamaHost: this.ollamaHost,
                currentModel: this.currentModel
            }, null, 2), 'utf-8');
            console.log(`[Config] Guardado persistente en ${CONFIG_PATH}`);
        } catch (e) {
            console.error('[Config] Error guardando config persistente:', e.message);
        }
    },

    setModel(newModel) {
        if (newModel && typeof newModel === 'string') {
            this.currentModel = newModel.trim();
            this.guardarConfig({ model: this.currentModel });
        }
    }
};
