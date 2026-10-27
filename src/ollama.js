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

export async function generarStream({ prompt, signal, onChunk, model = null }) {
    const modeloUso = model || config.currentModel;
    const url = `http://${config.ollamaHost}/api/generate`;

    const respuesta = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: modeloUso,
            prompt: prompt,
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
                if (json.response) {
                    respuestaAcumulada += json.response;
                    if (onChunk) onChunk(json.response);
                }
            } catch {}
        }
    }

    return respuestaAcumulada;
}
