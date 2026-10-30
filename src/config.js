import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

let app = null;
if (process.versions && process.versions.electron) {
    try {
        const require = createRequire(import.meta.url);
        const electron = require('electron');
        app = electron.app || null;
    } catch {}
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.resolve(__dirname, '..');

// Cargar .env de desarrollo SOLO si no estamos en la app empaquetada
const esProduccionEmpaquetada = Boolean(app && app.isPackaged);
if (!esProduccionEmpaquetada) {
    dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });
}

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
    // Flag indicating whether to route requests through the local daemon (port 11435)
    useDaemon: configGuardada.useDaemon || false,
    // Si es un DMG distribuido a un usuario final y no ha guardado su IP, empieza VACÍO (Dummy)
    // para que obligatoriamente se abra el Asistente de Setup
    ollamaHost: configGuardada.ollamaHost || (esProduccionEmpaquetada ? '' : process.env.OLLAMA_HOST || ''),
    currentModel: configGuardada.currentModel || (esProduccionEmpaquetada ? '' : process.env.OLLAMA_MODEL || ''),
    language: configGuardada.language || 'es',
    projectRoot: PROJECT_ROOT,
    skillsDir: path.join(PROJECT_ROOT, 'skills'),

    guardarConfig({ host, model, language, useDaemon }) {
        if (host !== undefined) {
            let cleanHost = host.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
            if (!cleanHost.includes(':')) {
                cleanHost += ':11434';
            }
            this.ollamaHost = cleanHost;
        }
        if (model !== undefined) {
            this.currentModel = model.trim();
        }
        if (language !== undefined) {
            this.language = language === 'en' ? 'en' : 'es';
        }
        if (useDaemon !== undefined) {
            this.useDaemon = !!useDaemon;
        }
        try {
            const dir = path.dirname(CONFIG_PATH);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(
                CONFIG_PATH,
                JSON.stringify(
                    {
                        ollamaHost: this.ollamaHost,
                        currentModel: this.currentModel,
                        language: this.language,
                        useDaemon: this.useDaemon,
                    },
                    null,
                    2
                ),
                'utf-8'
            );
        } catch (e) {
            console.error('[Config] Error guardando config persistente:', e.message);
        }
    },

    setModel(newModel) {
        if (newModel && typeof newModel === 'string') {
            this.currentModel = newModel.trim();
            this.guardarConfig({ model: this.currentModel });
        }
    },
};