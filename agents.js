import readline from 'readline';
import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

import { config } from './src/config.js';
import { generarStream } from './src/ollama.js';
import { procesarInputUsuario } from './src/commands.js';
import { obtenerSkills } from './src/skills-loader.js';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function ejecutarPrompt(parsed) {
    const promptCompleto = `${parsed.contexto}Instrucción: ${parsed.promptFinal}`.trim();
    
    if (parsed.skillAplicada) {
        console.log(chalk.magenta(`⚡ [Skill activada: ${parsed.skillAplicada.nombre.toUpperCase()}]`));
    }
    if (parsed.info) {
        console.log(chalk.gray(parsed.info));
    }

    process.stdout.write(chalk.green(`\n🤖 [${config.currentModel}]: `));

    try {
        const respuesta = await generarStream({
            prompt: promptCompleto,
            onChunk: (chunk) => process.stdout.write(chalk.cyan(chunk))
        });
        console.log(chalk.gray('\n----------------------------------------\n'));

        if (parsed.modoEdicion && parsed.archivoDestino) {
            fs.writeFileSync(parsed.archivoDestino, respuesta.trim(), 'utf-8');
            console.log(chalk.green(`✅ [Guardado en ${parsed.archivoDestino}]`));
        }

        if (parsed.modoEditaRepo) {
            try {
                const cambios = JSON.parse(respuesta.trim());
                let count = 0;
                for (const { ruta, contenido } of cambios) {
                    const rutaAbsoluta = path.join(config.projectRoot, ruta);
                    fs.writeFileSync(rutaAbsoluta, contenido.trim(), 'utf-8');
                    console.log(chalk.green(`✅ [Guardado: ${ruta}]`));
                    count++;
                }
                console.log(chalk.bgGreen.black(`\n🎯 [edita-repo completado: ${count} archivo(s) modificado(s)]`));
            } catch (err) {
                console.error(chalk.red(`\n❌ [Error parseando JSON: ${err.message}]`));
            }
        }
    } catch (err) {
        console.error(chalk.red(`\n[Error]: ${err.message}`));
    }
}

function iniciarChat() {
    rl.question(chalk.yellow('Tú: '), async (input) => {
        const trimmed = input.trim();
        if (trimmed.toLowerCase() === 'salir' || trimmed.toLowerCase() === 'exit') {
            console.log(chalk.gray('Cerrando agente CLI...'));
            rl.close();
            return;
        }

        if (trimmed === '') {
            iniciarChat();
            return;
        }

        // Comando para cambiar modelo desde la terminal: /modelo <nombre>
        const matchModelo = trimmed.match(/^\/?modelo\s+(.+)/i);
        if (matchModelo) {
            config.setModel(matchModelo[1]);
            console.log(chalk.green(`Modelo cambiado a: ${config.currentModel}\n`));
            iniciarChat();
            return;
        }

        const parsed = procesarInputUsuario(trimmed);
        if (parsed.error) {
            console.log(chalk.red(`[Error]: ${parsed.error}`));
        } else {
            await ejecutarPrompt(parsed);
        }

        iniciarChat();
    });
}

const skillsCargadas = obtenerSkills().map(s => s.nombre).join(', ');
console.log(chalk.bgBlue.white.bold(` ENLACE TAILSCALE -> ${config.ollamaHost} [${config.currentModel}] `));
console.log(chalk.gray(`Skills detectadas: [${skillsCargadas}]`));
console.log(chalk.gray(`Comandos: "lee", "lee-repo", "edita", "edita-repo", "/modelo <nombre>", "salir"\n`));
iniciarChat();
