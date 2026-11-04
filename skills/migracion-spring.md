---
name: migracion-spring
description: Guía de migración precisa para Spring Boot desde versiones 2.x EoL hacia 3.x y 4.x
triggers: ["spring", "springboot", "spring-boot", "pom.xml", "migrar", "migracion", "upgrade", "4.1.1", "2.7"]
---
# Directrices de Migración para Spring Boot 2.7 -> 4.x:
1. **Java Baseline:** Asegúrate de que el proyecto use Java 17 o Java 21 como versión mínima en el `pom.xml`.
2. **Jakarta EE:** Reemplaza absolutamente todos los paquetes `javax.servlet.*`, `javax.persistence.*`, `javax.validation.*` y `javax.annotation.*` por sus equivalentes en `jakarta.*`.
3. **Spring Security:** Nunca uses `WebSecurityConfigurerAdapter` ni `.authorizeRequests()`. Emplea siempre un `@Bean SecurityFilterChain` con `.authorizeHttpRequests()` y configuración de lambdas.
4. **Propiedades:** Actualiza los renombres de `application.properties`/`application.yml` (como `spring.data.redis.*`).
5. **Drivers:** Asegúrate de que los drivers modernos usen las coordenadas vigentes (ej. `com.mysql:mysql-connector-j`).
