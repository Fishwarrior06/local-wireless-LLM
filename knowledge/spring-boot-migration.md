# Guía de Migración y Breaking Changes: Spring Boot 2.7 EoL a Spring Boot 4.1.1 (Java 17+, Spring Framework 7 y Jakarta EE)

<!-- CHUNK: BASELINE_MAVEN_JAVA -->
<!-- TAGS: pom.xml, java, baseline, compiler, parent, spring-boot-starter-parent, 4.1.1 -->
## 1. Maven Baseline y Versión de Java
- **Java Baseline:** Spring Boot 4.1.1 requiere como mínimo **Java 17** (soporta Java 17 hasta Java 26).
- **Core Framework:** Spring Framework 7.0.
- **En `pom.xml`:**
  ```xml
  <properties>
      <java.version>17</java.version>
      <maven.compiler.source>17</maven.compiler.source>
      <maven.compiler.target>17</maven.compiler.target>
  </properties>
  ```
- **Parent Starter:**
  ```xml
  <parent>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-parent</artifactId>
      <version>4.1.1</version>
      <relativePath/>
  </parent>
  ```
- **Drivers de Base de Datos:**
  - *MySQL (solo si existe en el pom):* `mysql:mysql-connector-java` ➔ `com.mysql:mysql-connector-j`
  - *SQL Server (si existe):* `com.microsoft.sqlserver:mssql-jdbc` se mantiene gestionado por el starter parent.

<!-- CHUNK: JAKARTA_EE_NAMESPACE -->
<!-- TAGS: jakarta, javax, servlet, jpa, validation, persistence, transaction, jms, spring-boot-starter-web, spring-boot-starter-data-jpa, spring-boot-starter-activemq -->
## 2. Migración del Namespace de Jakarta EE (javax.* -> jakarta.*)
Spring Boot 3.x migró por completo de Java EE a **Jakarta EE 10**.
Todos los imports en el código fuente deben actualizarse:
- `javax.persistence.*` ➔ `jakarta.persistence.*` (`@Entity`, `@Id`, `@Table`, `@Column`, `CriteriaBuilder`, etc.)
- `javax.validation.*` ➔ `jakarta.validation.*` (`@NotNull`, `@Size`, `@Valid`, `@NotBlank`, etc.)
- `javax.servlet.*` ➔ `jakarta.servlet.*`
- `javax.transaction.*` ➔ `jakarta.transaction.*` (`@Transactional`)
- `javax.annotation.*` ➔ `jakarta.annotation.*` (`@PostConstruct`, `@PreDestroy`)
- `javax.jms.*` ➔ `jakarta.jms.*` (Messaging / ActiveMQ)

<!-- CHUNK: JMS_ACTIVEMQ_MIGRATION -->
<!-- TAGS: jms, activemq, spring-boot-starter-activemq, activemq-client, artemis, broker -->
## 3. Mensajería JMS y ActiveMQ en Spring Boot 3.x
- En Spring Boot 2.7, `spring-boot-starter-activemq` utilizaba ActiveMQ 5.x clásico bajo el namespace legacy `javax.jms`.
- En Spring Boot 3.x, JMS requiere obligatoriamente `jakarta.jms.*`.
- **Solución con ActiveMQ Clásico:** Utilizar la dependencia con clasificador Jakarta:
  ```xml
  <dependency>
      <groupId>org.apache.activemq</groupId>
      <artifactId>activemq-client-jakarta</artifactId>
  </dependency>
  ```
- O migrar a ActiveMQ Artemis (`spring-boot-starter-artemis`).
- Eliminar dependencias de test legacy como `activemq-junit` 5.17 que dependan de `javax.jms`.

<!-- CHUNK: SPRING_DATA_JPA_HIBERNATE -->
<!-- TAGS: spring-boot-starter-data-jpa, jpa, hibernate, hibernate6, datasource, entity, repository -->
## 4. Spring Data JPA y Hibernate 6.x
- **Hibernate 6:** Hibernate 6 fue reescrito para compilar queries directamente en árboles sintácticos (SQM).
- **Tipos de Columnas Personalizadas:**
  - Las anotaciones antiguas `@Type(type = "com.vladmihalcea.hibernate.type.json.JsonBinaryType")` están deprecadas/eliminadas.
  - Usar la anotación nativa de Hibernate 6: `@JdbcTypeCode(SqlTypes.JSON)`.
- **Dialectos de Base de Datos:**
  - Ya NO es necesario especificar dialectos como `SQLServer2012Dialect` en `application.yml` o `properties`. Hibernate detecta la base de datos automáticamente vía JDBC Metadata.

<!-- CHUNK: SPRING_SECURITY -->
<!-- TAGS: spring-boot-starter-security, security, websecurity, filterchain, authorizehttprequests, auth, csrf -->
## 5. Spring Security 6.x (Solo si el proyecto incluye spring-security)
- Si el proyecto incluye Spring Security, la clase abstracta `WebSecurityConfigurerAdapter` ha sido eliminada.
- Se debe emplear un `@Bean SecurityFilterChain` con `.authorizeHttpRequests()`.
- En APIs REST stateless que no usan sesiones web tradicionales, revisar que los filtros de tokens/JWT usen `jakarta.servlet.Filter`.

<!-- CHUNK: SPRING_WEB_MVC -->
<!-- TAGS: spring-boot-starter-web, restcontroller, mvc, web, resttemplate, restclient, trailing-slash -->
## 6. Spring Web y Clientes HTTP
- **Trailing Slash Matching:** En 3.x ya no se ignoran las barras finales en las rutas de controllers por defecto.
- **WebClient y RestClient:** Se mantiene `spring-boot-starter-webflux` para clientes reactivos o `RestClient` para clientes síncronos modernos.
