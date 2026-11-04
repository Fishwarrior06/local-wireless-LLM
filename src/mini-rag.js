import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { config, PROJECT_ROOT } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Directorio base de conocimiento integrado
const KNOWLEDGE_DIR = path.join(PROJECT_ROOT, 'knowledge');

// Cache en memoria de los chunks cargados para no leer disco en cada token
let chunksCache = null;
let cacheTimestamp = 0;

/**
 * Extrae starters, versiones y palabras clave esenciales de un archivo pom.xml.
 */
export function extraerDependenciasPom(contenidoPom) {
    if (!contenidoPom) return { versionParent: null, javaVersion: null, starters: [], keywords: [] };

    // Extraer versión de Spring Boot parent
    let versionParent = null;
    const parentMatch = contenidoPom.match(/<parent>[\s\S]*?<artifactId>spring-boot-starter-parent<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/parent>/i);
    if (parentMatch) {
        versionParent = parentMatch[1].trim();
    } else {
        // Buscar version en dependencias directas si no usa parent
        const depParentMatch = contenidoPom.match(/<artifactId>spring-boot(?:-dependencies)?<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>/i);
        if (depParentMatch) versionParent = depParentMatch[1].trim();
    }

    // Extraer versión de Java
    let javaVersion = null;
    const javaMatch = contenidoPom.match(/<(?:java\.version|maven\.compiler\.source|maven\.compiler\.target)>([^<]+)<\//i);
    if (javaMatch) {
        javaVersion = javaMatch[1].trim();
    }

    // Extraer todos los artifactIds y groupIds relevantes
    const starters = [];
    const keywords = ['pom.xml'];
    if (versionParent) keywords.push(`springboot-${versionParent}`);
    if (javaVersion) keywords.push(`java-${javaVersion}`);

    const regexArtifact = /<artifactId>([^<]+)<\/artifactId>/gi;
    let match;
    while ((match = regexArtifact.exec(contenidoPom)) !== null) {
        const id = match[1].trim();
        if (id.startsWith('spring-boot-starter-') || id.includes('security') || id.includes('jpa') || id.includes('hibernate')) {
            starters.push(id);
            keywords.push(id);
        }
        if (id.includes('mysql') || id.includes('postgres') || id.includes('oracle') || id.includes('h2')) {
            keywords.push(id);
        }
        if (id.includes('lombok') || id.includes('actuator') || id.includes('webflux')) {
            keywords.push(id);
        }
    }

    return {
        versionParent,
        javaVersion,
        starters: [...new Set(starters)],
        keywords: [...new Set(keywords)]
    };
}

/**
 * Divide un documento Markdown en chunks atómicos basados en delimitadores
 * <!-- CHUNK: ID --> o títulos de segundo nivel (##).
 */
export function parsearDocumentoMarkdown(contenido, archivoNombre = 'doc') {
    const chunks = [];
    
    // Si contiene delimitadores explícitos <!-- CHUNK: ... -->
    if (contenido.includes('<!-- CHUNK:')) {
        const partes = contenido.split(/(?=<!--\s*CHUNK:\s*[A-Z0-9_-]+\s*-->)/i);
        for (const parte of partes) {
            const trimmed = parte.trim();
            if (!trimmed) continue;

            const idMatch = trimmed.match(/<!--\s*CHUNK:\s*([A-Z0-9_-]+)\s*-->/i);
            const tagsMatch = trimmed.match(/<!--\s*TAGS:\s*([^>]+)\s*-->/i);

            const id = idMatch ? idMatch[1] : `chunk_${Math.random().toString(36).substring(2, 7)}`;
            const tags = tagsMatch
                ? tagsMatch[1].split(',').map(t => t.trim().toLowerCase())
                : [];

            // Limpiar comentarios de encabezado del contenido final que ve la IA
            const contenidoLimpio = trimmed
                .replace(/<!--\s*CHUNK:[^>]+-->/gi, '')
                .replace(/<!--\s*TAGS:[^>]+-->/gi, '')
                .trim();

            const lineas = contenidoLimpio.split('\n');
            const titulo = lineas[0] ? lineas[0].replace(/^#+\s*/, '').trim() : id;

            // Estimación rápida de tokens (~4 caracteres por token)
            const tokensAprox = Math.ceil(contenidoLimpio.length / 4);

            chunks.push({
                id,
                archivo: archivoNombre,
                titulo,
                tags,
                contenido: contenidoLimpio,
                tokensAprox,
                vector: null
            });
        }
    } else {
        // Fallback: Dividir por títulos Markdown ##
        const secciones = contenido.split(/(?=\n##\s+)/);
        for (let i = 0; i < secciones.length; i++) {
            const sec = secciones[i].trim();
            if (sec.length < 50) continue;
            const lineas = sec.split('\n');
            const titulo = lineas[0].replace(/^#+\s*/, '').trim();
            chunks.push({
                id: `${archivoNombre}_sec_${i}`,
                archivo: archivoNombre,
                titulo,
                tags: [titulo.toLowerCase(), archivoNombre.toLowerCase()],
                contenido: sec,
                tokensAprox: Math.ceil(sec.length / 4),
                vector: null
            });
        }
    }

    return chunks;
}

/**
 * Carga todos los documentos de conocimiento Markdown desde knowledge/
 */
export function cargarBaseDeConocimiento() {
    const ahora = Date.now();
    // Cache de 30 segundos en memoria para desarrollo
    if (chunksCache && (ahora - cacheTimestamp < 30000)) {
        return chunksCache;
    }

    const todosLosChunks = [];

    if (fs.existsSync(KNOWLEDGE_DIR)) {
        const archivos = fs.readdirSync(KNOWLEDGE_DIR);
        for (const arch of archivos) {
            if (arch.endsWith('.md') || arch.endsWith('.markdown')) {
                try {
                    const full = path.join(KNOWLEDGE_DIR, arch);
                    const contenido = fs.readFileSync(full, 'utf-8');
                    const parsed = parsearDocumentoMarkdown(contenido, arch);
                    todosLosChunks.push(...parsed);
                } catch (e) {
                    console.warn(`[Mini-RAG] Error leyendo ${arch}:`, e.message);
                }
            }
        }
    }

    chunksCache = todosLosChunks;
    cacheTimestamp = ahora;
    return chunksCache;
}

/**
 * Cálculo del producto punto y similitud coseno entre dos vectores.
 */
export function similitudCoseno(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    const divisor = Math.sqrt(normA) * Math.sqrt(normB);
    return divisor === 0 ? 0 : dot / divisor;
}

/**
 * Consulta el endpoint /api/embeddings de Ollama.
 * Si falla o no está disponible, retorna null limpiamente.
 */
export async function generarEmbedding(texto, hostOllama, model = 'nomic-embed-text') {
    if (!hostOllama) return null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);
        const res = await fetch(`http://${hostOllama}/api/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, prompt: texto.substring(0, 1000) }),
            signal: controller.signal
        });
        clearTimeout(timeout);
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data.embedding) ? data.embedding : null;
    } catch {
        return null; // Fallback tolerante si el modelo de embedding no está descargado
    }
}

/**
 * Recupera únicamente los chunks necesarios según las dependencias del pom.xml
 * o de la consulta, respetando un estricto presupuesto de tokens.
 */
export async function recuperarContextoMiniRAG({
    workspacePath = null,
    consulta = '',
    tokenBudget = 1500,
    hostOllama = null
}) {
    const host = hostOllama || config.ollamaHost;
    const todosLosChunks = cargarBaseDeConocimiento();
    if (todosLosChunks.length === 0) {
        return { contexto: '', chunksUsados: [], info: null };
    }

    let pomData = null;
    const keywordsBuscadas = new Set();

    // 1. Si hay workspace, buscar pom.xml
    if (workspacePath) {
        const rutaPom = path.join(workspacePath, 'pom.xml');
        if (fs.existsSync(rutaPom)) {
            try {
                const contenidoPom = fs.readFileSync(rutaPom, 'utf-8');
                pomData = extraerDependenciasPom(contenidoPom);
                pomData.keywords.forEach(k => keywordsBuscadas.add(k.toLowerCase()));
                pomData.starters.forEach(s => keywordsBuscadas.add(s.toLowerCase()));
            } catch (e) {
                console.warn('[Mini-RAG] Error leyendo pom.xml:', e.message);
            }
        }
    }

    // 2. Extraer términos de la consulta del usuario
    const palabrasConsulta = consulta.toLowerCase().match(/[a-zA-Z0-9_\-\.]{3,}/g) || [];
    palabrasConsulta.forEach(p => keywordsBuscadas.add(p));

    // Palabras con alta relevancia técnica para Spring Boot
    const terminosClave = ['spring', 'springboot', 'security', 'jpa', 'hibernate', 'jakarta', 'javax', 'properties', 'web', 'mvc', 'jms', 'activemq', '4.1.1', '2.7', 'migration'];
    terminosClave.forEach(t => {
        if (consulta.toLowerCase().includes(t)) keywordsBuscadas.add(t);
    });

    const listaKeywords = Array.from(keywordsBuscadas);

    // 3. Intento de embedding para búsqueda semántica
    let vectorConsulta = null;
    if (host && listaKeywords.length > 0) {
        const queryTexto = listaKeywords.join(' ') + ' ' + consulta.substring(0, 200);
        vectorConsulta = await generarEmbedding(queryTexto, host);
    }

    // 4. Scoring híbrido (Vectorial + Ponderación de Starters del pom.xml)
    const chunksPuntuados = todosLosChunks.map(chunk => {
        let score = 0;

        // A. Puntuación semántica si hubo vector
        if (vectorConsulta && chunk.vector) {
            score += similitudCoseno(vectorConsulta, chunk.vector) * 0.5;
        }

        // B. Coincidencia directa de Starters y Tags (Determinista, peso prioritario)
        for (const kw of listaKeywords) {
            // Match exacto en los tags del chunk
            if (chunk.tags.some(t => t.includes(kw) || kw.includes(t))) {
                score += 1.5;
            }
            // Match en el título
            if (chunk.titulo.toLowerCase().includes(kw)) {
                score += 1.0;
            }
            // Match en el contenido
            if (chunk.contenido.toLowerCase().includes(kw)) {
                score += 0.2;
            }
        }

        // Boost especial si el starter del pom coincide exactamente con un tag del chunk
        if (pomData && pomData.starters.length > 0) {
            for (const st of pomData.starters) {
                if (chunk.tags.includes(st.toLowerCase())) {
                    score += 3.0; // Prioridad absoluta a los componentes que están en el pom
                }
            }
        }

        return { ...chunk, score };
    });

    // 5. Ordenar por relevancia y aplicar presupuesto estricto de tokens
    chunksPuntuados.sort((a, b) => b.score - a.score);

    const seleccionados = [];
    let tokensAcumulados = 0;

    for (const chunk of chunksPuntuados) {
        if (chunk.score <= 0.4) continue; // Descartar irrelevantes
        if (tokensAcumulados + chunk.tokensAprox > tokenBudget) {
            // Si supera el presupuesto, detenerse para no saturar el contexto
            break;
        }
        seleccionados.push(chunk);
        tokensAcumulados += chunk.tokensAprox;
    }

    if (seleccionados.length === 0) {
        return { contexto: '', chunksUsados: [], info: null };
    }

    // 6. Formatear bloque de contexto para el LLM
    let contexto = `=== MINI RAG: REGLAS Y CAMBIOS DE MIGRACIÓN EXACTOS (${tokensAcumulados} tokens) ===\n`;
    if (pomData && pomData.versionParent) {
        contexto += `[Detectado en pom.xml]: Spring Boot v${pomData.versionParent} (Java: ${pomData.javaVersion || '17'})\n`;
        contexto += `[Starters activos en el proyecto]: ${pomData.starters.join(', ')}\n\n`;
    }
    contexto += `INSTRUCCIÓN CRÍTICA: Aplica estas directrices EXCLUSIVAMENTE a las tecnologías que estén presentes en el proyecto (no inventes dependencias ni frameworks no listados):\n\n`;

    for (const sel of seleccionados) {
        contexto += `--- [${sel.titulo}] ---\n${sel.contenido}\n\n`;
    }
    contexto += `=== FIN DIRECTRICES MINI RAG ===\n\n`;

    const info = `[Mini-RAG: ${seleccionados.length} chunks cargados (${tokensAcumulados} tokens)]`;

    return {
        contexto,
        chunksUsados: seleccionados.map(s => s.titulo),
        tokensEstimados: tokensAcumulados,
        pomData,
        info
    };
}
