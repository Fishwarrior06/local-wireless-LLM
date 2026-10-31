---
name: unslop
description: Transforma interfaces generadas por IA o vibecodificadas en interfaces artesanales con carácter propio, eliminando brillos genéricos, gradientes púrpuras y emojis innecesarios respetando la arquitectura de diseño Liquid Glass y macOS.
triggers: ["unslop", "quitar-slop", "pulir-ui", "rediseñar-ui", "craft-ui"]
---
# Skill: Unslop (Diseño y Refinamiento Artesanal de UI)

Basado en la metodología de Damir Sokolovsky (@heydamir).
Convierte interfaces con aspecto artificial, sobrecargadas o "vibecoded" en interfaces con craft, intención y carácter propio.

## Principios Clave
1. **Chrome Silencioso:** Los fondos, barras de navegación, botones y bordes deben ser sobrios (tintes neutros, desenfoques sutiles Liquid Glass, sin brillos estridentes).
2. **Momento Principal:** La riqueza visual y el color se concentran en uno o dos momentos clave (el contenido, visualizaciones o tarjetas destacadas), no esparcidos por todas partes.
3. **Tipografía y Jerarquía:** Cero etiquetas mayúsculas con tracking exagerado o badges redundantes con emojis ("New ✨"). Espaciado rítmico y predecible.
4. **Preservación Arquitectónica en local-wireless-LLM:**
   - Mantener intactos los IDs y clases esenciales de `ui/index.html` vinculados a `main.js` y `preload.js`.
   - Respetar la integración con Apple SF Symbols (`electron-sfsymbols` y atributos `data-sf`).
   - Mantener el soporte de tema Liquid Glass (macOS blur / vibrance).
