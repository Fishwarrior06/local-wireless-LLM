import { config } from './config.js';

const DAEMON_PORT = 11435;

/**
 * Extrae la IP o dominio base del host configurado (quitando el puerto).
 */
export function obtenerHostBase(hostCompleto = null) {
    const raw = (hostCompleto || config.ollamaHost || '127.0.0.1:11434').trim().replace(/^https?:\/\//i, '');
    const partes = raw.split(':');
    return partes[0] || '127.0.0.1';
}

/**
 * Comprueba si el daemon asíncrono está activo en el puerto 11435 del Host.
 */
export async function verificarDaemonDisponible(hostCompleto = null) {
    const hostBase = obtenerHostBase(hostCompleto);
    const url = `http://${hostBase}:${DAEMON_PORT}/health`;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 1200);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);
        if (!res.ok) return false;
        const data = await res.json();
        return Boolean(data.daemon);
    } catch {
        return false;
    }
}

/**
 * Consulta el estado y resultado acumulado de un Job pendiente en el daemon.
 */
export async function consultarEstadoJob(jobId, hostCompleto = null) {
    const hostBase = obtenerHostBase(hostCompleto);
    const url = `http://${hostBase}:${DAEMON_PORT}/api/jobs/${encodeURIComponent(jobId)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) {
        throw new Error(`Job no encontrado o error del daemon HTTP ${res.status}`);
    }
    return await res.json();
}

/**
 * Aborta un Job en el daemon.
 */
export async function abortarJob(jobId, hostCompleto = null) {
    const hostBase = obtenerHostBase(hostCompleto);
    const url = `http://${hostBase}:${DAEMON_PORT}/api/jobs/${encodeURIComponent(jobId)}/abort`;
    try {
        const res = await fetch(url, { method: 'POST' });
        return res.ok;
    } catch {
        return false;
    }
}

export async function listarModelosOllama() {
    try {
        const res = await fetch(`http://${config.ollamaHost}/api/tags`);
        if (!res.ok) {
            throw new Error(`Error HTTP ${res.status}`);
        }
        const data = await res.json();
        return data.models ? data.models.map(m => m.name) : [];
    } catch (err) {
        console.warn(`[Ollama] No se pudieron listar los modelos: ${err.message}`);
        return [config.currentModel, 'qwen3.5:4b', 'qwen3-coder', 'gemma4:12b'];
    }
}

/**
 * Genera una respuesta consumiendo el Daemon Asíncrono con reconexión automática.
 * Si se cae el WiFi o la conexión se interrumpe, reintenta conectarse al stream
 * usando el offset acumulado sin perder tokens ni interrumpir la GPU del host.
 */
async function generarStreamConDaemon({
    jobId,
    prompt,
    systemPrompt = '',
    historial = [],
    signal,
    onChunk,
    model = null,
    onReconnecting = null
}) {
    const hostBase = obtenerHostBase();
    const modeloUso = model || config.currentModel;
    const urlJobs = `http://${hostBase}:${DAEMON_PORT}/api/jobs`;

    // 1. Registrar o verificar el Job en el daemon
    const resCrear = await fetch(urlJobs, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id: jobId,
            model: modeloUso,
            prompt,
            systemPrompt,
            historial
        }),
        signal
    });

    if (!resCrear.ok) {
        const errText = await resCrear.text();
        throw new Error(`Error registrando trabajo en daemon: ${errText}`);
    }

    // 2. Conectarse al stream con soporte de reconexión
    let respuestaAcumulada = '';
    let completado = false;
    let intentosReconexion = 0;
    const maxIntentos = 30;

    while (!completado && intentosReconexion < maxIntentos) {
        if (signal?.aborted) {
            await abortarJob(jobId);
            throw new Error('Generación detenida por el usuario');
        }

        const offset = respuestaAcumulada.length;
        const urlStream = `http://${hostBase}:${DAEMON_PORT}/api/jobs/${encodeURIComponent(jobId)}/stream?offset=${offset}`;

        try {
            const streamRes = await fetch(urlStream, { signal });
            if (!streamRes.ok) {
                throw new Error(`Error conectando a stream de job (${streamRes.status})`);
            }

            intentosReconexion = 0; // Resetear intentos al conectar con éxito

            const decoder = new TextDecoder('utf-8');
            let bufferLectura = '';

            for await (const chunk of streamRes.body) {
                bufferLectura += decoder.decode(chunk, { stream: true });
                const eventos = bufferLectura.split('\n\n');
                bufferLectura = eventos.pop() || ''; // El último puede estar incompleto

                for (const evento of eventos) {
                    const lineaData = evento.split('\n').find(l => l.startsWith('data: '));
                    if (!lineaData) continue;
                    try {
                        const payload = JSON.parse(lineaData.slice(6));
                        if (payload.type === 'chunk' && payload.token) {
                            respuestaAcumulada += payload.token;
                            if (onChunk) onChunk(payload.token);
                        } else if (payload.type === 'catchup' && payload.text) {
                            respuestaAcumulada += payload.text;
                            if (onChunk) onChunk(payload.text);
                        } else if (payload.type === 'done') {
                            completado = true;
                            if (payload.output && payload.output.length > respuestaAcumulada.length) {
                                const faltante = payload.output.slice(respuestaAcumulada.length);
                                respuestaAcumulada += faltante;
                                if (onChunk) onChunk(faltante);
                            }
                            return respuestaAcumulada;
                        } else if (payload.type === 'error') {
                            throw new Error(payload.error || 'Error en ejecución del modelo en el daemon');
                        }
                    } catch (parseErr) {
                        if (parseErr.message.includes('daemon') || parseErr.message.includes('modelo')) {
                            throw parseErr;
                        }
                    }
                }
            }

            // Si el stream terminó sin evento 'done', verificar el estado del job
            const info = await consultarEstadoJob(jobId);
            if (info.status === 'completed') {
                completado = true;
                if (info.output && info.output.length > respuestaAcumulada.length) {
                    const faltante = info.output.slice(respuestaAcumulada.length);
                    respuestaAcumulada += faltante;
                    if (onChunk) onChunk(faltante);
                }
                return respuestaAcumulada;
            }
        } catch (err) {
            if (signal?.aborted || err.name === 'AbortError') {
                // Solo abortamos en el Host si el usuario hizo clic explícito en 'Detener'
                await abortarJob(jobId);
                throw new Error('Generación detenida por el usuario');
            }

            intentosReconexion++;
            console.warn(`[Daemon Stream] Conexión interrumpida (posible suspensión o corte de WiFi). Intento ${intentosReconexion}/${maxIntentos}...`);
            if (onReconnecting) onReconnecting(intentosReconexion);

            if (intentosReconexion >= maxIntentos) {
                // NO abortamos en el host: el modelo sigue corriendo en la GPU
                console.log(`[Daemon Stream] Reintentos en vivo pausados. El Job ${jobId} sigue activo en el Host para recuperación al despertar.`);
                throw new Error(`Conexión con el servidor pausada (la Mac entró en reposo o perdió red). El modelo sigue generando en la GPU y se sincronizará al reconectar.`);
            }

            // Esperar progresivamente antes de reconectar (2s - 4s)
            const delay = Math.min(4000, 1500 + intentosReconexion * 500);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return respuestaAcumulada;
}

/**
 * Genera una respuesta en streaming usando /api/chat de Ollama directo.
 */
async function generarStreamDirectoOllama({ prompt, systemPrompt = '', historial = [], signal, onChunk, model = null }) {
    const modeloUso = model || config.currentModel;
    const url = `http://${config.ollamaHost}/api/chat`;

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

    const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modeloUso,
            messages,
            stream: true
        }),
        signal
    });

    if (!respuesta.ok) {
        const errorTexto = await respuesta.text();
        throw new Error(`Ollama Error ${respuesta.status}: ${errorTexto}`);
    }

    let respuestaAcumulada = "";
    for await (const chunk of respuesta.body) {
        const textoLimpio = new TextDecoder("utf-8").decode(chunk);
        const lineas = textoLimpio.split('\n').filter(l => l.trim() !== '');
        for (const linea of lineas) {
            try {
                const json = JSON.parse(linea);
                const token = json.message?.content;
                if (token) {
                    respuestaAcumulada += token;
                    if (onChunk) onChunk(token);
                }
            } catch {}
        }
    }

    return respuestaAcumulada;
}

/**
 * Entrada principal: detecta automáticamente si el daemon está disponible
 * para usar la cola asíncrona resiliente con reconexión; de lo contrario usa Ollama directo.
 */
export async function generarStream({
    prompt,
    systemPrompt = '',
    historial = [],
    signal,
    onChunk,
    model = null,
    jobId = null,
    onReconnecting = null
}) {
    const idFinal = jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const daemonDisponible = await verificarDaemonDisponible();

    if (daemonDisponible) {
        console.log(`[Stream] Usando daemon asíncrono desacoplado en puerto ${DAEMON_PORT} (Job: ${idFinal})`);
        return await generarStreamConDaemon({
            jobId: idFinal,
            prompt,
            systemPrompt,
            historial,
            signal,
            onChunk,
            model,
            onReconnecting
        });
    }

    console.log(`[Stream] Daemon no detectado. Usando conexión directa a Ollama (${config.ollamaHost})`);
    return await generarStreamDirectoOllama({
        prompt,
        systemPrompt,
        historial,
        signal,
        onChunk,
        model
    });
}

