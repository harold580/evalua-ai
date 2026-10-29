# Manual de usuario de EvaluaIA

**Versión:** 1.0  
**Fecha:** 29 de octubre de 2026  
**Dirigido a:** docentes y personas que revisan evaluaciones

EvaluaIA ayuda a calificar exámenes de selección múltiple a partir de fotografías o imágenes. La aplicación usa inteligencia artificial para leer el contenido y las marcas; el docente debe revisar los casos dudosos antes de registrar una nota definitiva.

## 1. Requisitos

- Un navegador actualizado y conexión a internet.
- Para tomar fotos desde la aplicación, un dispositivo con cámara y permiso del navegador. La cámara requiere HTTPS; la versión publicada ya usa HTTPS.
- Archivos de imagen JPG/JPEG, PNG o WebP. No se reciben PDF ni SVG. El límite por imagen cargada es de 10 MB.
- Un máximo de seis hojas por examen.

La versión publicada está en [evalua-ai-lac.vercel.app](https://evalua-ai-lac.vercel.app).

## 2. Antes de calificar

1. Asegúrate de que el texto, las opciones y las marcas se vean completos y enfocados.
2. Evita sombras, reflejos, hojas cortadas y marcas demasiado tenues.
3. Si el examen tiene varias hojas, ordénalas antes de calificar. EvaluaIA lee las páginas en el orden mostrado y numera las preguntas de manera continua.
4. Ten presente que cada estudiante procesado puede consumir créditos de la cuenta de OpenRouter configurada por el administrador.

Para tomar fotos, permite el acceso a la cámara cuando el navegador lo solicite. La guía sobre el video indica si hay suficiente detalle; ajusta el encuadre o la orientación cuando lo pida.

## 3. Calificar a un estudiante

1. En la página principal, selecciona **Un estudiante**.
2. Agrega las hojas del examen desde el dispositivo o selecciona **Tomar las fotos ahora**.
   - Puedes cargar varias imágenes juntas.
   - Con la cámara, toma una hoja, revisa la imagen y continúa. La cámara permanece abierta para las hojas siguientes.
3. Revisa las miniaturas. Usa las flechas para cambiar el orden, el botón de giro si una hoja quedó de lado y la **X** para retirar una hoja.
4. Cuando las páginas estén completas y en orden, selecciona **Calificar la hoja** o **Calificar las N hojas**.
5. Espera a que termine el análisis. La pantalla muestra el nombre detectado, la nota sobre 5.0, las respuestas correctas e incorrectas y el detalle pregunta por pregunta.
6. Revisa con cuidado las preguntas marcadas **Revisar**. Se excluyen del cálculo de la nota porque el sistema no pudo determinar con confianza la marca o la respuesta. Contrástalas con la hoja original antes de cerrar la calificación.
7. Selecciona **Nueva Evaluación** para empezar otra vez.

En esta modalidad el resultado se muestra en pantalla. Si necesitas guardar una copia, conserva los datos por el medio aprobado por tu institución antes de iniciar otra evaluación o cerrar la pestaña.

## 4. Calificar un curso (carga masiva)

1. En la página principal, selecciona **Carga masiva**.
2. Indica cuántas hojas tiene cada examen:
   - **Detectar solo** agrupa por carpetas o por nombres de archivo con número de página.
   - **1–6** agrupa las imágenes en bloques consecutivos de esa cantidad. Usa esta opción cuando todos los exámenes tengan el mismo número de hojas.
3. Carga un archivo ZIP/RAR del curso o selecciona imágenes sueltas. También puedes tomar las fotos en secuencia con **Fotografiar con la cámara**.
4. Verifica los grupos antes de continuar. Si el conteo u orden no es correcto, descarta la carga y vuelve a organizar los archivos. Esta revisión ocurre antes de enviar las hojas a calificar.
5. Selecciona **Calificar N estudiantes**. La lista muestra el avance y el estado de cada examen.
6. Si un estudiante queda con error, usa el control de reintento junto a ese registro. También puedes detener el lote: los resultados ya terminados quedan disponibles en pantalla.
7. Cuando termine, revisa las notas, los registros con error y **Temas a reforzar del curso**. Selecciona **Exportar a Excel** para descargar la planilla.

### Cómo organizar la carga masiva

En modo automático, la forma más clara de organizar un ZIP es una carpeta por estudiante con sus imágenes dentro, por ejemplo:

```text
curso.zip
├── 1001/
│   ├── hoja1.jpg
│   └── hoja2.jpg
└── 1002/
    ├── hoja1.jpg
    └── hoja2.jpg
```

También puedes poner las imágenes en la raíz del ZIP y usar nombres que incluyan el identificador y la página, por ejemplo `1001_p1.jpg`, `1001_p2.jpg`, `1002_p1.jpg`. Si no hay carpetas ni número de página, cada imagen se interpreta como un estudiante distinto.

Con un número fijo de hojas, las imágenes se ordenan por nombre y se reparten en bloques. Si el último grupo está incompleto, la aplicación muestra un aviso; comprueba que no falte ni sobre una página. No mezcles un archivo comprimido con imágenes sueltas en la misma selección: carga una sola modalidad a la vez.

El ZIP/RAR se abre en tu dispositivo. Para calificar, las hojas de cada estudiante sí se envían al servidor de EvaluaIA y al servicio de IA OpenRouter. La aplicación no conserva las fotos ni las notas en una base de datos; los resultados del lote permanecen en memoria en esa pestaña. Descarga el Excel antes de cerrarla. La gestión posterior de los datos por el proveedor externo depende de sus condiciones de servicio y de la configuración de la cuenta.

## 5. Interpretar y guardar los resultados

- **Correctas** e **incorrectas** resumen las respuestas que se pudieron calificar.
- **Por revisar** señala preguntas que no se pudieron determinar con suficiente confianza. No cuentan como error ni entran en el denominador de la nota.
- La nota se expresa en escala de 0.0 a 5.0 y se calcula como respuestas correctas divididas entre preguntas calificadas, multiplicado por 5.
- En la carga masiva, el Excel incluye estudiante, identificador, correctas, incorrectas, por revisar, total y nota. El identificador proviene del nombre o carpeta usada para agrupar; si la IA detecta un nombre, este se muestra como nombre del estudiante.
- La planilla se descarga al dispositivo desde el navegador. EvaluaIA no mantiene un historial de las notas.

La inteligencia artificial puede leer mal una imagen o interpretar incorrectamente una pregunta. No uses el resultado sin revisar las preguntas dudosas y compararlo con el examen original.

## 6. Controles de la página

- **Guía de Marcación:** consulta ejemplos y niveles de compatibilidad de las marcas.
- **Configuración de IA** (icono de engranaje): muestra si el servidor tiene una clave de OpenRouter configurada y qué modelo está activo. Esta ventana es informativa; no introduzcas claves de API en el navegador.
- **Acerca de:** muestra los créditos del equipo desarrollador.

## 7. Solución de problemas

| Situación | Qué hacer |
|---|---|
| La cámara no abre | Permite la cámara en el navegador, comprueba que otra aplicación no la esté usando o carga imágenes guardadas. La cámara solo funciona en HTTPS o en `localhost`. |
| La cámara pide más detalle | Acerca la hoja, mejora la iluminación, enfoca y espera a que el indicador confirme que está lista. |
| El archivo no se acepta | Usa JPG/JPEG, PNG o WebP, verifica que sea una imagen válida y que pese 10 MB o menos. |
| Los grupos del curso quedaron mal | Comprueba las carpetas, los nombres de página y la cantidad fija de hojas. Descarta y carga de nuevo antes de calificar. |
| OpenRouter aparece sin configurar | Contacta a la persona administradora del proyecto; la clave se configura en el servidor/Vercel, no en esta pantalla. |
| Aparece un límite de solicitudes | Espera unos segundos y vuelve a intentarlo. |
| Una pregunta aparece como “Revisar” | Consulta la hoja original; la aplicación no asigna una respuesta definitiva a esa pregunta. |
| Se cerró la pestaña antes de exportar | Los resultados del lote no se guardan en EvaluaIA. Si aún no se descargó el Excel, será necesario volver a cargar y calificar los exámenes. |

## Documentación relacionada

- [Manual técnico](manual-tecnico.md)
- [Guía de despliegue en Vercel](../SUBIR-A-VERCEL.md)
