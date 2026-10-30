import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { app, nativeImage } from 'electron';
import sfsymbols from 'electron-sfsymbols';

const { getSfSymbolAsBase64, getSfSymbolAsNativeImage } = sfsymbols;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Mapeo oficial de los SF Symbols soportados a sus assets vectoriales de respaldo
export const SF_SYMBOLS = {
    'sidebar.left': 'sidebar.svg',
    'gearshape': 'gear.svg',
    'plus': 'plus.svg',
    'folder.fill': 'folder.svg',
    'pencil': 'pencil.svg',
    'trash': 'trash.svg'
};

const base64Cache = new Map();
const nativeImageCache = new Map();

/**
 * Obtiene de forma síncrona el NativeImage de la caché o del fallback SVG
 * @param {string} nombre
 * @param {string} [fallbackSvg]
 * @returns {Electron.NativeImage|undefined}
 */
export function obtenerSfSymbolNativeImageSincrono(nombre, fallbackSvg) {
    if (nativeImageCache.has(nombre)) {
        return nativeImageCache.get(nombre);
    }
    const svgFile = fallbackSvg || SF_SYMBOLS[nombre] || `${nombre}.svg`;
    const svgPath = path.join(__dirname, '..', 'ui', 'assets', svgFile);
    if (fs.existsSync(svgPath)) {
        try {
            const img = nativeImage.createFromPath(svgPath).resize({ width: 16, height: 16 });
            return img;
        } catch {}
    }
    return undefined;
}

/**
 * Resuelve la ruta del binario `sfsymbol` según el entorno (producción vs desarrollo)
 */
export function getBinaryPath() {
    if (app && app.isPackaged) {
        return path.join(process.resourcesPath, 'bin', 'sfsymbol');
    }
    return path.join(__dirname, '..', 'node_modules', 'electron-sfsymbols', 'lib', 'bin', 'sfsymbol');
}

/**
 * Genera o recupera un SF Symbol en formato Data URL (base64 PNG o SVG fallback)
 * @param {string} nombre - Nombre del SF Symbol (ej: 'sidebar.left', 'gearshape')
 * @param {object} [opciones] - Opciones de personalización (size, weight, mode, primary, etc.)
 * @returns {Promise<string>} Data URL del símbolo
 */
export async function obtenerSfSymbolDataUrl(nombre, opciones = {}) {
    const cacheKey = `${nombre}_${JSON.stringify(opciones)}`;
    if (base64Cache.has(cacheKey)) {
        return base64Cache.get(cacheKey);
    }

    const fallbackSvg = SF_SYMBOLS[nombre] || `${nombre}.svg`;
    const svgPath = path.join(__dirname, '..', 'ui', 'assets', fallbackSvg);

    // En macOS intentamos generar el SF Symbol nativo mediante electron-sfsymbols
    if (process.platform === 'darwin') {
        const bin = getBinaryPath();
        if (fs.existsSync(bin)) {
            try {
                try { fs.chmodSync(bin, 0o755); } catch {}

                const defaultOpts = {
                    size: 22,
                    scale: 2,
                    weight: 'medium',
                    mode: 'monochrome',
                    primary: '#FFFFFF'
                };
                const mergedOpts = { ...defaultOpts, ...opciones };
                const res = await getSfSymbolAsBase64(nombre, mergedOpts, bin);
                if (res && typeof res === 'string') {
                    const dataUrl = res.startsWith('data:') ? res.trim() : `data:image/png;base64,${res.trim()}`;
                    base64Cache.set(cacheKey, dataUrl);
                    return dataUrl;
                }
            } catch (err) {
                console.warn(`[SF-Symbols] Advertencia generando '${nombre}' vía binario:`, err.message);
            }
        }
    }

    // Fallback multiplataforma (Windows/Linux o error en macOS): SVG como data URL
    if (fs.existsSync(svgPath)) {
        try {
            const svgContent = fs.readFileSync(svgPath, 'utf-8');
            const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgContent)}`;
            base64Cache.set(cacheKey, dataUrl);
            return dataUrl;
        } catch (err) {
            console.error(`[SF-Symbols] Error cargando SVG fallback para '${nombre}':`, err.message);
        }
    }

    return null;
}

/**
 * Genera o recupera un SF Symbol como objeto NativeImage de Electron
 * @param {string} nombre - Nombre del SF Symbol (ej: 'plus', 'folder.fill')
 * @param {object} [opciones] - Opciones del símbolo
 * @returns {Promise<Electron.NativeImage|null>}
 */
export async function obtenerSfSymbolNativeImage(nombre, opciones = {}) {
    const cacheKey = `${nombre}_${JSON.stringify(opciones)}`;
    if (nativeImageCache.has(cacheKey)) {
        return nativeImageCache.get(cacheKey);
    }

    const fallbackSvg = SF_SYMBOLS[nombre] || `${nombre}.svg`;
    const svgPath = path.join(__dirname, '..', 'ui', 'assets', fallbackSvg);

    if (process.platform === 'darwin') {
        const bin = getBinaryPath();
        if (fs.existsSync(bin)) {
            try {
                try { fs.chmodSync(bin, 0o755); } catch {}
                const defaultOpts = {
                    size: 16,
                    scale: 2,
                    weight: 'regular',
                    mode: 'monochrome',
                    primary: '#FFFFFF'
                };
                const mergedOpts = { ...defaultOpts, ...opciones };
                const img = await getSfSymbolAsNativeImage(nombre, mergedOpts, bin);
                if (img && !img.isEmpty()) {
                    nativeImageCache.set(cacheKey, img);
                    nativeImageCache.set(nombre, img);
                    return img;
                }
            } catch (err) {
                console.warn(`[SF-Symbols] Fallback NativeImage para '${nombre}':`, err.message);
            }
        }
    }

    if (fs.existsSync(svgPath)) {
        try {
            const img = nativeImage.createFromPath(svgPath).resize({ width: 16, height: 16 });
            nativeImageCache.set(cacheKey, img);
            nativeImageCache.set(nombre, img);
            return img;
        } catch {}
    }

    return null;
}

/**
 * Obtiene de forma masiva (batch) los SF Symbols solicitados
 * @param {string[]} nombres - Lista de nombres de SF Symbols
 * @param {object} [opciones] - Opciones de renderizado
 * @returns {Promise<Record<string, string>>}
 */
export async function obtenerTodosLosSfSymbols(nombres = Object.keys(SF_SYMBOLS), opciones = {}) {
    const resultado = {};
    await Promise.all(
        nombres.map(async (nom) => {
            const dataUrl = await obtenerSfSymbolDataUrl(nom, opciones);
            if (dataUrl) {
                resultado[nom] = dataUrl;
            }
        })
    );
    return resultado;
}
