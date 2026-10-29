import { matchLetter } from '../api/_gradePipeline.js';
const casos=[
  ['-5',{A:'5',B:'-5'},'B','signo menos'],
  ['1.5',{A:'15',B:'1.5'},'B','punto decimal'],
  ['2,5',{A:'25',B:'2,5'},'B','coma decimal'],
  ['3',{A:'30',B:'13',C:'3.5'},'?','numero sin equivalente exacto'],
  ['56',{A:'54',B:'56',C:'48'},'B','caso normal'],
  ['5',{A:'15',B:'5'},'B','exacto gana a contencion'],
  ['Marte',{A:'Venus',B:'Marte'},'B','texto exacto'],
  ['celula',{A:'celula vegetal',B:'celula animal'},'?','ambiguo -> no adivinar'],
  ['Paris',{A:'Londres',B:'Paris',C:'Roma'},'B','ciudad'],
  ['$ 3000',{A:'$36.000',B:'$18.000',C:'$6000',D:'$3000'},'D','moneda con espacio'],
];
let ok=0;
for(const [v,o,esp,nota] of casos){
  const r=matchLetter(v,o);
  const bien=r===esp; if(bien) ok++;
  console.log(`  ${bien?'✓':'✗'} ${nota}: matchLetter("${v}") = ${r} (esperado ${esp})`);
}
console.log(`\nRESULTADO: ${ok}/${casos.length}`);
if (ok !== casos.length) process.exitCode = 1;
