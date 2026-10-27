import fs from 'fs';
import path from 'path';
import { config } from './config.js';

let skillsCache = [];

export function cargarSkills() {
    skillsCache = [];
    if (!fs.existsSync(config.skillsDir)) {
        fs.mkdirSync(config.skillsDir, { recursive: true });
        return skillsCache;
    }

    const archivos = fs.readdirSync(config.skillsDir);
    for (const archivo of archivos) {
        if (!archivo.endsWith('.md')) continue;

        try {
            const rutaCompleta = path.join(config.skillsDir, archivo);
            const contenido = fs.readFileSync(rutaCompleta, 'utf-8');

            let nombre = path.basename(archivo, '.md');
            let descripcion = 'Skill personalizada';
            let triggers = [nombre];
            let cuerpo = contenido;

            // Extraer frontmatter simple (entre --- y ---)
            const matchFrontmatter = contenido.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
            if (matchFrontmatter) {
                const cabecera = matchFrontmatter[1];
                cuerpo = matchFrontmatter[2].trim();

                const matchName = cabecera.match(/name:\s*(.+)/i);
                if (matchName) nombre = matchName[1].trim();

                const matchDesc = cabecera.match(/description:\s*(.+)/i);
                if (matchDesc) descripcion = matchDesc[1].trim();

                const matchTriggers = cabecera.match(/triggers:\s*\[(.*?)\]/i);
                if (matchTriggers) {
                    triggers = matchTriggers[1].split(',').map(t => t.replace(/["']/g, '').trim()).filter(Boolean);
                }
            }

            skillsCache.push({
                nombre,
                descripcion,
                triggers,
                instrucciones: cuerpo,
                archivo
            });
        } catch (err) {
            console.error(`[Skills] Error cargando skill ${archivo}:`, err.message);
        }
    }
    return skillsCache;
}

export function obtenerSkills() {
    if (skillsCache.length === 0) {
        return cargarSkills();
    }
    return skillsCache;
}

// Busca una skill por comando directo (ej: /refactorizar o /skill refactorizar)
// o por coincidencia de palabras clave
export function detectarSkill(texto) {
    const skills = obtenerSkills();
    if (!texto) return null;

    // 1. Detección directa por comando /skill <nombre>
    const matchSkillCmd = texto.match(/^\/?skill\s+([a-zA-Z0-9_-]+)/i);
    if (matchSkillCmd) {
        const buscado = matchSkillCmd[1].toLowerCase();
        const encontrada = skills.find(s => s.nombre.toLowerCase() === buscado || s.triggers.includes(buscado));
        if (encontrada) return { skill: encontrada, tipo: 'comando_explicito' };
    }

    // 2. Detección por comando directo /<nombre_skill>
    const matchDirecto = texto.match(/^\/?([a-zA-Z0-9_-]+)(?:\s+(.*))?$/);
    if (matchDirecto) {
        const primerToken = matchDirecto[1].toLowerCase();
        const encontrada = skills.find(s => s.nombre.toLowerCase() === primerToken);
        if (encontrada) return { skill: encontrada, tipo: 'comando_directo', resto: matchDirecto[2] || '' };
    }

    // 3. Detección por alusión contextual (triggers en el texto)
    const textoMin = texto.toLowerCase();
    for (const sk of skills) {
        for (const trig of sk.triggers) {
            const regexTrigger = new RegExp(`\\b${trig}\\b`, 'i');
            if (regexTrigger.test(textoMin)) {
                return { skill: sk, tipo: 'mencion_contextual' };
            }
        }
    }

    return null;
}
