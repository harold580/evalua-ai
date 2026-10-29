import { normalizeTranscript, matchLetter, extractJSON } from '../api/_gradePipeline.js';
let ok=0, tot=0;
const t=(nombre,cond)=>{tot++; if(cond) ok++; console.log(`  ${cond?'✓':'✗'} ${nombre}`);};

// null dentro del array de preguntas
const r1=normalizeTranscript({preguntas:[null,{id:1,opciones:{A:'x'}}]});
t('null en preguntas se filtra', r1 && r1.preguntas.length===1 && r1.preguntas[0].id===1);

// opciones como array
const r2=normalizeTranscript({preguntas:[{id:1,opciones:['54','56','48','64']}]});
t('opciones array -> {A,B,C,D}', r2.preguntas[0].opciones.B==='56' && Object.keys(r2.preguntas[0].opciones).length===4);
t('matchLetter sobre opciones convertidas', matchLetter('56', r2.preguntas[0].opciones)==='B');

// marca anidada dentro de opciones
const r3=normalizeTranscript({preguntas:[{id:1,opciones:{A:'x',B:'y',letra_marcada:'B',texto_marcado:'y'}}]});
t('marca anidada se sube al nivel correcto', r3.preguntas[0].letra_marcada==='B' && Object.keys(r3.preguntas[0].opciones).length===2);

// entradas basura
t('extractJSON con basura -> null', extractJSON('no soy json')===null);
t('extractJSON con null -> null', extractJSON(null)===null);
t('normalizeTranscript(null) -> null', normalizeTranscript(null)===null);
t('normalizeTranscript([]) -> null', normalizeTranscript([])===null);

// opciones vacias / raras
t('matchLetter sin opciones -> ?', matchLetter('5',{})==='?');
t('matchLetter valor vacio -> ?', matchLetter('',{A:'1'})==='?');
t('matchLetter opciones null -> ?', matchLetter('5',null)==='?');

console.log(`\nRESULTADO: ${ok}/${tot}`);
if (ok !== tot) process.exitCode = 1;
