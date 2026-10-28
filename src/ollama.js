import { config } from './config.js';

export async function listarModelosOllama() {
    try {
        const res = await fetch(`http://${config.ollamaHost}/api/tags`);
        if (!res.ok) {
            throw new Error(`Error HTTP ${res.status}`);
        }
        const data = await res.json();
        // data.models suele ser [{ name: 'qwen3.5:4b', ... }, { name: 'qwen3-coder', ... }]
        return data.models ? data.models.map(m => m.name) : [];
    } catch (err) {
        console.warn(`[Ollama] No se pudieron listar los modelos: ${err.message}`);
        // Fallback a los modelos conocidos si falla la red o está desconectado
        return [config.currentModel, 'qwen3.5:4b', 'qwen3-coder', 'gemma4:12b'];
    }
}

/**
 * Genera una respuesta en streaming usando /api/chat de Ollama.
 * @param {Object} opts
 * @param {string} opts.prompt       - Mensaje actual del usuario (texto plano)
 * @param {string} opts.systemPrompt - Contexto del workspace/repo como mensaje 'system'.
 *                                     Se coloca antes del historial para que el modelo lo
 *                                     trate como conocimiento de fondo y no como parte de
 *                                     la conversación, evitando el "recency bias".
 * @param {Array}  opts.historial    - Array de {rol: 'yo'|'ia', texto: string} de la sesión actual
 * @param {AbortSignal} opts.signal
 * @param {Function} opts.onChunk
 * @param {string|null} opts.model
 */
export async function generarStream({ prompt, systemPrompt = '', historial = [], signal, onChunk, model = null }) {
    const modeloUso = model || config.currentModel;
    const url = `http://${config.ollamaHost}/api/chat`;

    const messages = [];

    // El contexto del workspace va como rol 'system' ANTES del historial.
    // Esto evita que el modelo confunda el código del repositorio con la instrucción
    // actual y previene el sesgo de recencia (recency bias) en modelos pequeños.
    if (systemPrompt && systemPrompt.trim()) {
        messages.push({ role: 'system', content: systemPrompt.trim() });
    }

    // Convertir historial al formato de mensajes de Ollama (excluyendo el último msg vacío de la IA)
    historial
        .filter(m => m.texto && m.texto.trim() !== '')
        .forEach(m => messages.push({
            role: m.rol === 'yo' ? 'user' : 'assistant',
            content: m.texto
        }));

    // Añadir el mensaje actual del usuario al final
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
                // /api/chat devuelve json.message.content en cada chunk
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
