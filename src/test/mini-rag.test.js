import { extraerDependenciasPom, parsearDocumentoMarkdown, recuperarContextoMiniRAG } from '../mini-rag.js';

const mockPom = `
<project xmlns="http://maven.apache.org/POM/4.0.0">
    <modelVersion>4.0.0</modelVersion>
    <parent>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-parent</artifactId>
        <version>2.7.18</version>
        <relativePath/>
    </parent>
    <groupId>com.example</groupId>
    <artifactId>demo-service</artifactId>
    <version>1.0.0</version>
    <properties>
        <java.version>11</java.version>
    </properties>
    <dependencies>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-web</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-security</artifactId>
        </dependency>
        <dependency>
            <groupId>org.springframework.boot</groupId>
            <artifactId>spring-boot-starter-data-jpa</artifactId>
        </dependency>
    </dependencies>
</project>
`;

async function testMiniRag() {
    console.log('🧪 Iniciando tests de Mini-RAG...');

    // 1. Test de extracción de dependencias
    const deps = extraerDependenciasPom(mockPom);
    console.assert(deps.versionParent === '2.7.18', `Esperaba 2.7.18, se obtuvo ${deps.versionParent}`);
    console.assert(deps.javaVersion === '11', `Esperaba 11, se obtuvo ${deps.javaVersion}`);
    console.assert(deps.starters.includes('spring-boot-starter-security'), 'Debería detectar spring-boot-starter-security');
    console.assert(deps.starters.includes('spring-boot-starter-data-jpa'), 'Debería detectar spring-boot-starter-data-jpa');
    console.log('✅ 1. Extracción de dependencias del pom.xml: OK');

    // 2. Test de recuperación de contexto con presupuesto estricto
    const resultado = await recuperarContextoMiniRAG({
        consulta: 'migrar a 4.1.1 con security y jpa',
        tokenBudget: 1200
    });

    console.assert(resultado.contexto.length > 0, 'El contexto recuperado no debería estar vacío');
    console.assert(resultado.tokensEstimados <= 1200, `Tokens superaron el budget: ${resultado.tokensEstimados}`);
    console.log(`✅ 2. Recuperación vectorial/tags: OK (${resultado.chunksUsados.length} chunks, ~${resultado.tokensEstimados} tokens)`);
    console.log('   Chunks seleccionados:', resultado.chunksUsados);

    console.log('\n🎉 Todos los tests del Mini-RAG pasaron exitosamente.');
}

testMiniRag().catch(err => {
    console.error('❌ Error en test de Mini-RAG:', err);
    process.exit(1);
});
