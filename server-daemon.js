/**
 * server-daemon.js
 * 
 * Daemon asíncrono y resiliente para inferencia LLM desacoplada.
 * Se ejecuta en el equipo Host junto a Ollama (en el puerto 11435 por defecto).
 * 
 * Permite que las solicitudes a Ollama continúen ejecutándose en la GPU
 * incluso si el cliente (Mac) se apaga, cierra la tapa o pierde la conexión a internet.
 * Cuando el cliente recupera la conexión, puede reconectarse al stream o
 * descargar el resultado final completo y aplicar los cambios.
 * 
 * Ejecución:
 *   node server-daemon.js
 * 
 * Cero dependencias externas (usa solo módulos nativos de Node.js).
 */

import http from 'http';
import { URL } from 'url';

const PORT = parseInt(process.env.DAEMON_PORT || '11435', 10);
const OLLAMA_HOST = process.env.OLLAMA_LOCAL_HOST || '127.0.0.1:11434';

// Almacén en memoria de trabajos (Jobs)
// Map<string, Job>
const jobs = new Map();

/**
 * @typedef {Object} Job
 * @property {string} id
 * @property {'running'|'completed'|'failed'|'aborted'} status
 * @property {number} createdAt
 * @property {number|null} completedAt
 * @property {string} model
 * @property {string} output
 * @property {string|null} error
 * @property {AbortController} abortController
 * @property {Set<http.ServerResponse>} subscribers
 */

function responderJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    res.end(JSON.stringify(data));
}

async function verificarOllamaOnline() {
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://${OLLAMA_HOST}/api/tags`, { signal: controller.signal });
        clearTimeout(timeout);
        return res.ok;
    } catch {
        return false;
    }
}

async function procesarInferenciaOllama(job, { model, prompt, systemPrompt = '', historial = [] }) {
    const messages = [];

    if (systemPrompt && systemPrompt.trim()) {
        messages.push({ role: 'system', content: systemPrompt.trim() });
    }

    historial
        .filter(m => m.texto && m.texto.trim() !== '')
        .forEach(m => messages.push({
            role: m.rol === 'yo' ? 'user' : 'assistant',
            content: m.texto
        }));

    messages.push({ role: 'user', content: prompt });

    try {
        const respuesta = await fetch(`http://${OLLAMA_HOST}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages,
                stream: true
            }),
            signal: job.abortController.signal
        });

        if (!respuesta.ok) {
            const errText = await respuesta.text();
            throw new Error(`Ollama respondió con error HTTP ${respuesta.status}: ${errText}`);
        }

        const decoder = new TextDecoder('utf-8');
        for await (const chunk of respuesta.body) {
            if (job.status === 'aborted') break;
            const lineas = decoder.decode(chunk).split('\n').filter(l => l.trim() !== '');
            for (const linea of lineas) {
                try {
                    const parsed = JSON.parse(linea);
                    const token = parsed.message?.content;
                    if (token) {
                        job.output += token;
                        // Notificar a todos los clientes actualmente conectados
                        notificarSubscribers(job, { type: 'chunk', token, offset: job.output.length });
                    }
                } catch {}
            }
        }

        if (job.status !== 'aborted') {
            job.status = 'completed';
            job.completedAt = Date.now();
            notificarSubscribers(job, {
                type: 'done',
                output: job.output,
                durationSeconds: Math.round((job.completedAt - job.createdAt) / 1000)
            });
            console.log(`[Job ${job.id}] Completado exitosamente (${job.output.length} caracteres generados).`);
        }
    } catch (err) {
        if (err.name === 'AbortError' || job.status === 'aborted') {
            job.status = 'aborted';
            console.log(`[Job ${job.id}] Generación cancelada.`);
        } else {
            job.status = 'failed';
            job.error = err.message;
            console.error(`[Job ${job.id}] Error durante inferencia:`, err.message);
        }
        notificarSubscribers(job, { type: 'error', error: job.error || 'Generación abortada' });
    } finally {
        cerrarSubscribers(job);
    }
}

function notificarSubscribers(job, data) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of job.subscribers) {
        try {
            res.write(payload);
        } catch {}
    }
}

function cerrarSubscribers(job) {
    for (const res of job.subscribers) {
        try {
            res.end();
        } catch {}
    }
    job.subscribers.clear();
}

// Limpieza periódica de jobs antiguos (mayores a 24 horas)
setInterval(() => {
    const limite = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, job] of jobs.entries()) {
        if (job.createdAt < limite && job.status !== 'running') {
            jobs.delete(id);
        }
    }
}, 60 * 60 * 1000);

const server = http.createServer(async (req, res) => {
    // Soporte CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
        });
        res.end();
        return;
    }

    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // 1. Health Check
    if (pathname === '/health' || pathname === '/api/health') {
        const ollamaOk = await verificarOllamaOnline();
        const activeCount = Array.from(jobs.values()).filter(j => j.status === 'running').length;
        responderJSON(res, 200, {
            status: 'ok',
            daemon: true,
            port: PORT,
            ollamaHost: OLLAMA_HOST,
            ollamaOnline: ollamaOk,
            activeJobs: activeCount,
            totalJobs: jobs.size
        });
        return;
    }

    // 2. Crear nuevo Job
    if (pathname === '/api/jobs' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body || '{}');
                const id = data.id || `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
                const model = data.model || 'qwen3.5:4b';
                const prompt = data.prompt || '';
                const systemPrompt = data.systemPrompt || '';
                const historial = Array.isArray(data.historial) ? data.historial : [];

                // Si ya existe y está corriendo, retornarlo sin duplicar
                if (jobs.has(id)) {
                    const existente = jobs.get(id);
                    responderJSON(res, 200, {
                        success: true,
                        id: existente.id,
                        status: existente.status,
                        outputLength: existente.output.length,
                        yaExistia: true
                    });
                    return;
                }

                const job = {
                    id,
                    status: 'running',
                    createdAt: Date.now(),
                    completedAt: null,
                    model,
                    output: '',
                    error: null,
                    abortController: new AbortController(),
                    subscribers: new Set()
                };

                jobs.set(id, job);
                console.log(`[Job ${id}] Iniciado con modelo '${model}'.`);

                // Iniciar inferencia en segundo plano en el Host
                procesarInferenciaOllama(job, { model, prompt, systemPrompt, historial });

                responderJSON(res, 202, {
                    success: true,
                    id: job.id,
                    status: job.status,
                    createdAt: job.createdAt
                });
            } catch (err) {
                responderJSON(res, 400, { success: false, error: err.message });
            }
        });
        return;
    }

    // 3. Consultar estado y resultado completo de un Job: GET /api/jobs/:id
    const matchGetJob = pathname.match(/^\/api\/jobs\/([^\/]+)$/);
    if (matchGetJob && req.method === 'GET') {
        const id = matchGetJob[1];
        if (!jobs.has(id)) {
            responderJSON(res, 404, { success: false, error: `Job '${id}' no encontrado.` });
            return;
        }

        const job = jobs.get(id);
        const durationSeconds = job.completedAt
            ? Math.round((job.completedAt - job.createdAt) / 1000)
            : Math.round((Date.now() - job.createdAt) / 1000);

        responderJSON(res, 200, {
            success: true,
            id: job.id,
            status: job.status,
            model: job.model,
            output: job.output,
            outputLength: job.output.length,
            durationSeconds,
            createdAt: job.createdAt,
            completedAt: job.completedAt,
            error: job.error
        });
        return;
    }

    // 4. Reconexión y Streaming SSE: GET /api/jobs/:id/stream
    const matchStream = pathname.match(/^\/api\/jobs\/([^\/]+)\/stream$/);
    if (matchStream && req.method === 'GET') {
        const id = matchStream[1];
        if (!jobs.has(id)) {
            responderJSON(res, 404, { success: false, error: `Job '${id}' no encontrado.` });
            return;
        }

        const job = jobs.get(id);
        const offsetParam = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
        const offset = Math.max(0, isNaN(offsetParam) ? 0 : offsetParam);

        // Cabeceras Server-Sent Events (SSE)
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'
        });

        // 1. Enviar tokens acumulados que el cliente aún no tenga
        if (job.output.length > offset) {
            const restante = job.output.slice(offset);
            res.write(`data: ${JSON.stringify({ type: 'catchup', text: restante, offset: job.output.length })}\n\n`);
        }

        // 2. Si ya terminó mientras el cliente estuvo desconectado
        if (job.status === 'completed') {
            const durationSeconds = job.completedAt ? Math.round((job.completedAt - job.createdAt) / 1000) : 0;
            res.write(`data: ${JSON.stringify({ type: 'done', output: job.output, durationSeconds })}\n\n`);
            res.end();
            return;
        }

        if (job.status === 'failed' || job.status === 'aborted') {
            res.write(`data: ${JSON.stringify({ type: 'error', error: job.error || 'Job abortado' })}\n\n`);
            res.end();
            return;
        }

        // 3. Si sigue corriendo, suscribirlo para recibir tokens en vivo
        job.subscribers.add(res);

        // Si la Mac se desconecta nuevamente o cierra la conexión
        req.on('close', () => {
            job.subscribers.delete(res);
            console.log(`[Job ${id}] Cliente desconectado del stream. La inferencia continúa en segundo plano.`);
        });
        return;
    }

    // 5. Cancelar un Job: POST /api/jobs/:id/abort
    const matchAbort = pathname.match(/^\/api\/jobs\/([^\/]+)\/abort$/);
    if (matchAbort && req.method === 'POST') {
        const id = matchAbort[1];
        if (jobs.has(id)) {
            const job = jobs.get(id);
            job.status = 'aborted';
            job.abortController.abort();
            responderJSON(res, 200, { success: true, id, status: 'aborted' });
        } else {
            responderJSON(res, 404, { success: false, error: 'Job no encontrado' });
        }
        return;
    }

    // 6. Limpiar Job: DELETE /api/jobs/:id
    if (matchGetJob && req.method === 'DELETE') {
        const id = matchGetJob[1];
        if (jobs.has(id)) {
            const job = jobs.get(id);
            if (job.status === 'running') job.abortController.abort();
            jobs.delete(id);
            responderJSON(res, 200, { success: true, id, message: 'Job eliminado.' });
        } else {
            responderJSON(res, 404, { success: false, error: 'Job no encontrado' });
        }
        return;
    }

    responderJSON(res, 404, { error: 'Ruta no encontrada' });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🚀 Local-LLM Daemon activo en puerto ${PORT}`);
    console.log(`📡 Conectado a Ollama local en ${OLLAMA_HOST}`);
    console.log(`🛡️  Inferencia asíncrona desacoplada lista para Mac`);
    console.log(`=======================================================`);
});
