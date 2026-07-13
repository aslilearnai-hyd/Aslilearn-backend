import 'dotenv/config';
import { appendFileSync, writeFileSync } from 'fs';
process.env.AI_GENERATOR_V2_SIX_SECTION = 'on';
const OUT='/tmp/sweep_results.txt'; writeFileSync(OUT,'');
const { generateSixSectionContent } = await import('./services/six-section-generator.js');
const { buildV2VariantHint } = await import('./prompts/v2/assemble.js');
function extract(sc){const core=sc?.core||{};const out=[];const walk=(v)=>{if(typeof v==='string'){const t=v.trim();if(t.length>=15)out.push(t);}else if(Array.isArray(v)){for(const it of v){if(it&&typeof it==='object'&&typeof it.question==='string'){if(it.question.trim().length>=8)out.push(it.question.trim());}else walk(it);}}else if(v&&typeof v==='object'){for(const x of Object.values(v))walk(x);}};walk(core);return out;}
function norm(s){return String(s).toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,55);}
function garbage(sc){return [...JSON.stringify(sc)].filter(c=>{const x=c.codePointAt(0);return x===0xfffd||(x>=0xc0&&x<=0xff&&x!==0xd7&&x!==0xf7);}).length;}
const SCI={board:'CBSE',classLabel:'Class 10',subject:'Science',topic:'Life Processes',subTopic:'Photosynthesis'};
const MATH={board:'CBSE',classLabel:'Class 10',subject:'Mathematics',topic:'Polynomials',subTopic:'Zeroes of a Polynomial'};
const ENG={board:'CBSE',classLabel:'Class 6',subject:'English',topic:'Reading Skills',subTopic:'Comprehension'};
const TOOLS=[['worksheet-mcq-generator',SCI],['homework-creator',SCI],['mock-test-builder',MATH],['exam-question-paper-generator',MATH],['smart-qa-practice-generator',SCI],['quick-assignment-builder',SCI],['concept-mastery-helper',SCI],['concept-breakdown-explainer',MATH],['smart-study-guide-generator',SCI],['chapter-summary-creator',SCI],['key-points-formula-extractor',MATH],['short-notes-summaries-maker',SCI],['activity-project-generator',SCI],['project-idea-lab',SCI],['lesson-planner',SCI],['daily-class-plan-maker',SCI],['study-schedule-maker',MATH],['reading-practice-room',ENG],['story-passage-creator',ENG],['flashcard-generator',SCI],['my-study-decks',MATH]];
for(const [tool,params] of TOOLS){
  const used=[];const sigs=[];let g=0,ok=0,items0=0;
  for(let v=1;v<=2;v++){
    const hint=buildV2VariantHint({variantIndex:v,batchSize:2,seed:`${tool}${v}`});
    let r; try{ r=await generateSixSectionContent(tool,params,{primaryModel:'gemini-3.1-flash-lite',variantHint:hint,avoidQuestions:used.slice(0,40)}); }catch(e){ r={ok:false,error:e.message}; }
    if(!r.ok)continue;
    ok++; g+=garbage(r.structuredContent);
    const it=extract(r.structuredContent); if(v===1)items0=it.length; used.push(...it); it.forEach(x=>sigs.push(norm(x)));
  }
  const uniq=sigs.length?Math.round(new Set(sigs).size/sigs.length*100):0;
  const status = ok<2?'FAIL':(g>0?'GARBLE':(items0<3?'THIN':'OK'));
  appendFileSync(OUT, `${status.padEnd(7)} ${tool.padEnd(30)} ok ${ok}/2 | garbage ${g} | ${items0} items | ${uniq}% unique\n`);
}
appendFileSync(OUT, 'DONE\n');
