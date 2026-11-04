---
name: migracion-spring
description: Guía de migración técnica y precisa para Spring Boot desde 2.x EoL hacia 4.1.1 (Java 17+, Spring Framework 7 y Jakarta EE)
triggers: ["spring", "springboot", "spring-boot", "pom.xml", "migrar", "migracion", "upgrade", "4.1.1", "4.x", "2.7"]
---
# Directrices de Migración para Spring Boot 2.7 -> 4.1.1:
1. **Inspección Previa del `pom.xml`:** Identifica ÚNICAMENTE las dependencias, starters y conectores de base de datos realmente presentes en el proyecto antes de proponer cambios (no asumas MySQL, Redis ni Security si no existen).
2. **Java Baseline:** Asegúrate de que el proyecto use Java 17 como versión mínima en `<java.version>` (compatible con Java 17 a 26).
3. **Versión de Spring Boot:** La versión destino es Spring Boot 4.1.1 (basada en Spring Framework 7.0).
4. **Jakarta EE:** Reemplaza absolutamente todos los paquetes `javax.*` por sus equivalentes `jakarta.*` (`jakarta.persistence.*`, `jakarta.validation.*`, `jakarta.servlet.*`, `jakarta.jms.*`, `jakarta.transaction.*`).
5. **JMS / ActiveMQ:** Si el proyecto usa ActiveMQ o JMS, `spring-boot-starter-activemq` legacy (ActiveMQ 5.x) usa `javax.jms`. Debe actualizarse a un cliente con soporte Jakarta (`activemq-client-jakarta`) o migrar a `spring-boot-starter-artemis`.
6. **Spring Security:** Si existe en el pom.xml, nunca uses `WebSecurityConfigurerAdapter` ni `.authorizeRequests()`. Emplea siempre un `@Bean SecurityFilterChain` con `.authorizeHttpRequests()`.
7. **Hibernate 6/7:** Elimina dialectos explícitos de base de datos de la configuración (`spring.jpa.properties.hibernate.dialect` ya no es necesario; Hibernate lo autodetecta).
8. **BOM & Plugins:** Elimina overrides de versiones manuales como `<spring-framework.version>` y `<tomcat.version>` en properties para permitir que el starter parent de Spring Boot 4.1.1 gestione la compatibilidad de forma nativa.
