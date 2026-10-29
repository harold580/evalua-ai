# Pruebas de EvaluaIA

La suite normal no consume créditos ni requiere una API key:

```bash
npm test
```

Incluye:

- `openrouter-integracion.mjs`: contrato HTTP simulado, modelo único `openai/gpt-6-luna`, parámetros compatibles, reintentos, configuración sin clave y pipeline completo con visión + razonamiento simulados.
- `comparacion-respuestas.mjs`: mapeo determinista entre valores y letras.
- `robustez-entradas.mjs`: tolerancia a JSON y estructuras imperfectas.
- `deteccion-burbujas.mjs`: detección por píxeles con marcas sintéticas A-D.

Las suites heredadas ahora devuelven un código de salida distinto de cero si algún caso falla, para evitar resultados verdes falsos en CI.

## Smoke test real de OpenRouter

Esta prueba es voluntaria y consume una cantidad pequeña de créditos. Configura `.env` con:

```dotenv
OPENROUTER_API_KEY=tu_clave
OPENROUTER_MODEL=openai/gpt-6-luna
```

Ejecuta:

```bash
npm run test:openrouter:live
```

La prueba envía una imagen sintética, exige una respuesta JSON válida, comprueba que respondió GPT-6 Luna y verifica la burbuja marcada esperada. Nunca imprime la clave.
