import fs from 'fs';
import readline from 'readline';
import chalk from 'chalk';
import dotenv from 'dotenv';

// Cargar variables del archivo .env
dotenv.config();

const OLLAMA_HOST = process.env.OLLAMA_HOST;
const MODEL = process.env.OLLAMA_MODEL;
const OLLAMA_URL = `http://${OLLAMA_HOST}/api/generate`;

if (!OLLAMA_HOST) {
    console.error(chalk.red("Error: Falta OLLAMA_HOST en el archivo .env"));
    process.exit(1);
}

// Interfaz de consola
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function preguntarAPI(promptBase, contexto = "") {
    const promptCompleto = `${contexto}\n\nInstrucción: ${promptBase}`.trim();
    
    try {
        const respuesta = await fetch(OLLAMA_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL,
                prompt: promptCompleto,
                stream: true // Muestra la respuesta en tiempo real
            })
        });

        if (!respuesta.ok) throw new Error(`HTTP Error: ${respuesta.status}`);

        process.stdout.write(chalk.green('\n🤖 Qwen: '));

        // Procesamiento del stream para ver la respuesta escribiéndose
        for await (const chunk of respuesta.body) {
            const textoLimpio = new TextDecoder("utf-8").decode(chunk);
            const lineas = textoLimpio.split('\n').filter(linea => linea.trim() !== '');
            
            for (const linea of lineas) {
                const json = JSON.parse(linea);
                if (json.response) {
                    process.stdout.write(chalk.cyan(json.response));
                }
            }
        }
        console.log(chalk.gray('\n----------------------------------------\n'));
    } catch (error) {
        console.error(chalk.red("\n[Error de conexión con la PC]:", error.message));
        console.log(chalk.yellow("Verifica que Tailscale esté activo y la IP sea correcta en el .env\n"));
    }
}

function procesarComando(input) {
    let contexto = "";
    let promptFinal = input;

    // Detector de lectura de archivos: Si empiezas con "lee archivo.js"
    const regexLectura = /^lee\s+([^\s]+)\s*(.*)/i;
    const match = input.match(regexLectura);

    if (match) {
        const rutaArchivo = match[1];
        promptFinal = match[2] || "Analiza este archivo."; // Si no hay instrucción extra, solo analiza

        try {
            const contenido = fs.readFileSync(rutaArchivo, 'utf-8');
            contexto = `--- INICIO DEL ARCHIVO: ${rutaArchivo} ---\n${contenido}\n--- FIN DEL ARCHIVO ---`;
            console.log(chalk.gray(`[Mac: Archivo '${rutaArchivo}' cargado en memoria]`));
        } catch (e) {
            console.log(chalk.red(`[Mac: Error leyendo el archivo '${rutaArchivo}': ${e.message}]`));
            return false; // Detener si falla la lectura
        }
    }

    return { promptFinal, contexto };
}

function iniciarChat() {
    rl.question(chalk.yellow('Tú: '), async (input) => {
        if (input.toLowerCase() === 'salir' || input.toLowerCase() === 'exit') {
            console.log(chalk.gray('Apagando Nube Privada...'));
            rl.close();
            return;
        }

        if (input.trim() === '') {
            iniciarChat();
            return;
        }

        const { promptFinal, contexto } = procesarComando(input);
        
        if (promptFinal !== false) {
            await preguntarAPI(promptFinal, contexto);
        }
        
        iniciarChat();
    });
}

console.log(chalk.bgBlue.white.bold(` INICIANDO ENLACE TAILSCALE -> ${OLLAMA_HOST} [${MODEL}] `));
console.log(chalk.gray(`Comandos especiales: "lee <archivo.java> <instrucción>" | "salir"\n`));
iniciarChat();