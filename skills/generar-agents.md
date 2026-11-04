---
name: generar-agents
description: Genera un archivo AGENTS.md institucional y a medida para cualquier microservicio Spring Boot / Java, adaptando la arquitectura real del repositorio según el estándar corporativo enterprise.
triggers: ["generar-agents", "crear-agents", "agents.md", "estandar-agents", "guia-agentes", "adaptar-agents"]
---
# Skill: Generador de AGENTS.md (Estándar Enterprise Spring Boot)

Esta skill permite redactar o actualizar el archivo `AGENTS.md` de cualquier repositorio o microservicio basándose en estándares de ingeniería de software enterprise de alta calidad, adaptándolo **estrictamente a la realidad del proyecto actual**.

---

## 🎯 Instrucciones de Inspección Previa (Cero Alucinaciones)

Antes de generar el contenido del `AGENTS.md`, el agente debe inspeccionar el repositorio activo y determinar:
1. **Identidad del Servicio:**
   - Lee `pom.xml`: Extrae `<artifactId>`, `<groupId>`, `<name>`, `<description>`, versión de Java (`<java.version>`) y parent version.
2. **Estructura Real de Paquetes (`src/main/java`):**
   - Mapea los paquetes Java reales presentes en el proyecto (ej. `configuration/`, `controller/`, `domain/`, `dto/`, `exception/`, `jms/`, `model/`, `repository/`, `service/`, `specs/`, `utils/`).
3. **Formato de Configuración:**
   - Detecta si el proyecto usa `application.yml` / `.yaml` o `application.properties` (y sus variantes `dev`, `local`, `uat`, `prod`).
4. **Infraestructura Local (Docker Compose):**
   - Revisa si existe `docker-compose.yml`, `docker-compose-deps.yml` o similar.
   - Extrae los nombres de servicios reales (ej. `database`, `wiremock`, `activemq`, etc.) y sus puertos asignados.
5. **Naturaleza de los Controladores:**
   - Si es microservicio REST puro: únicamente `@RestController` retornando `ResponseEntity<T>` o JSON.
   - Si es aplicación web monolito: documentar capas `@Controller` (Thymeleaf/MVC) vs `@RestController`.
6. **Manejo de Base de Datos y Changelog:**
   - Si existen scripts manuales en `src/main/resources/sql_scripts/` y `CHANGELOG_DB.md`, documentar su obligatoriedad.
   - Si no existen, incluir la convención estándar para migraciones y trazabilidad de esquema.

---

## 📋 Estructura Obligatoria del Documento `AGENTS.md`

El `AGENTS.md` generado debe contener obligatoriamente las siguientes secciones según el estándar institucional:

1. **Encabezado y Contexto del Proyecto:**
   - Título con emoji `# 🤖 AGENTS.md — AI Agent Contribution Guide`.
   - Propósito del microservicio y sus integraciones (mensajería, bases de datos, APIs externas).
   - Referencia de tickets del gestor de tareas: `SC-{XXXX}` (o equivalente del equipo).
2. **Contexto Obligatorio antes de Diseñar/Implementar:**
   - Regla de lectura de `docs/` y tickets previos antes de generar código.
3. **Documentación Post-Feature Obligatoria:**
   - Convención de nombres: `docs/<ticket-id>-<short-kebab-slug>.md`.
   - Estructura requerida: Contexto, Qué cambió (DB / API), Decisiones de diseño, Cómo probar.
4. **Árbol del Repositorio:**
   - Representación ASCII fiel del árbol de carpetas del proyecto actual con comentarios descriptivos por paquete.
5. **Convenciones Java & Spring Boot:**
   - Java 17+ (según `pom.xml`).
   - DTOs con Lombok (`@Data` + factorías estáticas `from(...)`), sin Java records si el proyecto usa `@Data`.
   - Inyección por constructor con `@RequiredArgsConstructor` (prohibido `@Autowired` en campos).
   - `Optional<T>` para retornos anulables (cero retornos `null` en servicios).
   - Logging con `@Slf4j` (prohibido `System.out.println` o `e.printStackTrace()`).
   - Nomenclatura: PascalCase, camelCase, UPPER_SNAKE_CASE, snake_case en DB.
   - Manejo de excepciones centralizado (`@RestControllerAdvice`).
6. **Estándares de Pruebas:**
   - Comandos Maven (`mvn test`, `mvn verify`, `mvn install -DskipTests`).
   - Pirámide de pruebas: Unitarias con Mockito (sin contexto Spring), `@WebMvcTest` para controladores, `@DataJpaTest` para repositorios, `@SpringBootTest` para integración.
   - Patrón AAA (Arrange-Act-Assert).
   - Procedimiento de pruebas E2E locales sin credenciales (Docker Compose + perfil de desarrollo local).
7. **Reglas de Seguridad y OWASP:**
   - Prohibición estricta de credenciales, passwords, tokens y PII en código o logs.
   - Consultas siempre parametrizadas (cero concatenación SQL/JPQL).
   - Validación de CVEs con OWASP Dependency Check.
8. **Configuración de IDE y Estilo de Código:**
   - Indentación de 4 espacios, máximo 120 caracteres por línea.
   - Orden de imports sin comodines (prohibido `import java.util.*`).
   - Trailing newline en cada archivo.
9. **Flujo de Git y Pull Requests:**
   - Nomenclatura de ramas: `<type>/<ticket-id>-kebab-case`.
   - Commits con Conventional Commits + Gitmoji (`✨ feat(...)`, `🐛 fix(...)`, `🧪 test(...)`, etc.).
   - Template de Pull Request de `.github/pull_request_template.md`.
10. **Comandos Maven & Docker de Referencia:**
    - Comandos exactos del proyecto para compilar, empaquetar, correr localmente y levantar dependencias en Docker.
11. **Lista Prohibitiva ("What Agents Must Never Do"):**
    - Las reglas críticas que un agente de IA jamás debe romper en el repositorio.

---

## ⚡ Regla de Oro
Nunca copies dependencias o rutas de otros servicios si no existen en el microservicio actual. Genera el documento 100% fiel al `pom.xml`, carpetas y archivos de configuración del proyecto analizado.
