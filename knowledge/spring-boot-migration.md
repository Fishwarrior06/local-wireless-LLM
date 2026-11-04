# Guía de Migración y Breaking Changes: Spring Boot 2.7 EoL a Spring Boot 3.x / 4.x

<!-- CHUNK: BASELINE_MAVEN_JAVA -->
<!-- TAGS: pom.xml, java, baseline, compiler, parent, spring-boot-starter-parent -->
## 1. Maven Baseline y Versión de Java
- **Java Baseline:** Spring Boot 3.x y 4.x requieren obligatoriamente como mínimo **Java 17** (o Java 21 LTS recomendado). Java 8 y Java 11 ya no son compatibles.
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
- **MySQL Driver:** Cambió de groupId y artifactId:
  - *Antes (2.7):* `mysql:mysql-connector-java`
  - *Ahora (3.x/4.x):* `com.mysql:mysql-connector-j`

<!-- CHUNK: JAKARTA_EE_NAMESPACE -->
<!-- TAGS: jakarta, javax, servlet, jpa, validation, persistence, transaction, spring-boot-starter-web, spring-boot-starter-data-jpa -->
## 2. Migración del Namespace de Jakarta EE (javax.* -> jakarta.*)
Spring Boot 3.x/4.x migró por completo de Java EE a **Jakarta EE 10/11**.
Todos los imports en el código fuente deben actualizarse:
- `javax.servlet.*` ➔ `jakarta.servlet.*`
- `javax.persistence.*` ➔ `jakarta.persistence.*` (Entidades `@Entity`, `@Id`, `@Table`, `@Column`, etc.)
- `javax.validation.*` ➔ `jakarta.validation.*` (`@NotNull`, `@Size`, `@Valid`, `@NotBlank`, etc.)
- `javax.annotation.*` ➔ `jakarta.annotation.*` (`@PostConstruct`, `@PreDestroy`)
- `javax.transaction.*` ➔ `jakarta.transaction.*`
- `javax.websocket.*` ➔ `jakarta.websocket.*`

<!-- CHUNK: SPRING_SECURITY -->
<!-- TAGS: spring-boot-starter-security, security, websecurity, filterchain, authorizehttprequests, auth, csrf -->
## 3. Spring Security 6.x / 7.x
- **Eliminación de `WebSecurityConfigurerAdapter`:** La clase abstracta ha sido eliminada por completo.
- **Nuevo patrón `@Bean SecurityFilterChain`:**
  ```java
  @Configuration
  @EnableWebSecurity
  public class SecurityConfig {

      @Bean
      public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
          http
              .csrf(csrf -> csrf.disable())
              .authorizeHttpRequests(auth -> auth
                  .requestMatchers("/api/public/**", "/actuator/health").permitAll()
                  .anyRequest().authenticated()
              )
              .sessionManagement(sess -> sess.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
              .httpBasic(Customizer.withDefaults());

          return http.build();
      }

      @Bean
      public AuthenticationManager authenticationManager(AuthenticationConfiguration authConfig) throws Exception {
          return authConfig.getAuthenticationManager();
      }
  }
  ```
- **Cambios en métodos:**
  - `authorizeRequests()` ➔ Reemplazado por `authorizeHttpRequests()`.
  - `antMatchers(...)` ➔ Reemplazado por `requestMatchers(...)`.
  - Configuración fluida basada en lambdas obligatoria: `.csrf(Customizer.withDefaults())` en vez de `.csrf().disable()`.

<!-- CHUNK: SPRING_DATA_JPA_HIBERNATE -->
<!-- TAGS: spring-boot-starter-data-jpa, jpa, hibernate, hibernate6, datasource, entity, repository -->
## 4. Spring Data JPA y Hibernate 6.x / 7.x
- **Hibernate 6:** Hibernate 6 fue reescrito para compilar queries directamente en árboles sintácticos (SQM).
- **Tipos de Columnas Personalizadas:**
  - Las anotaciones antiguas `@Type(type = "com.vladmihalcea.hibernate.type.json.JsonBinaryType")` están deprecadas/eliminadas.
  - Usar la anotación nativa de Hibernate 6:
    ```java
    @JdbcTypeCode(SqlTypes.JSON)
    private Map<String, Object> metadata;
    ```
- **Dialectos de Base de Datos:**
  - Ya NO es necesario especificar `spring.jpa.database-platform` ni `hibernate.dialect` en `application.properties`. Hibernate detecta la versión exacta de la base de datos automáticamente vía JDBC Metadata.
- **HikariCP:** Viene por defecto optimizado sin configuraciones propietarias legacy.

<!-- CHUNK: SPRING_WEB_MVC -->
<!-- TAGS: spring-boot-starter-web, restcontroller, mvc, web, resttemplate, restclient, trailing-slash -->
## 5. Spring Web MVC y Clientes HTTP
- **Trailing Slash Matching:**
  - En Spring Boot 2.7, una ruta `/api/usuarios` respondía también automáticamente a `/api/usuarios/`.
  - En 3.x/4.x, por defecto ya NO se ignoran las barras finales (estricto por seguridad RFC 3986).
- **Nuevo cliente `RestClient`:**
  - Se introduce `RestClient` como la alternativa moderna y síncrona a `RestTemplate` (similar al API de `WebClient` pero sin reactividad obligatoria):
    ```java
    RestClient restClient = RestClient.create();
    String result = restClient.get()
        .uri("https://api.ejemplo.com/recurso")
        .retrieve()
        .body(String.class);
    ```

<!-- CHUNK: APPLICATION_PROPERTIES_RENAMES -->
<!-- TAGS: application.properties, application.yml, config, properties, configuration, redis, server -->
## 6. Renombres en application.properties / application.yml
- **Redis:**
  - `spring.redis.*` ➔ `spring.data.redis.*` (ej. `spring.data.redis.host`, `spring.data.redis.port`)
- **Web Resources:**
  - `spring.resources.*` ➔ `spring.web.resources.*`
- **Servidor HTTP:**
  - `server.max-http-header-size` ➔ `server.max-http-request-header-size`
- **Actuator & Management:**
  - `management.metrics.export.simple.*` ➔ `management.simple.metrics.export.*`
- **Jackson:**
  - `spring.jackson.serialization.write-dates-as-timestamps` se mantiene, pero módulos como JSR310 vienen registrados por defecto en el starter.
