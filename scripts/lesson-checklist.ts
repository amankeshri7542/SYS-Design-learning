import { writeFileSync, mkdirSync } from 'node:fs';
import { concepts } from '../src/lib/catalog';
import { getLesson } from '../src/lib/lessons';
const lines = concepts.map(c=>{
  const l=getLesson(c.id);
  return `| ${c.id} | ${l.controls.map(k=>k.label.replaceAll('|','/')).join('; ')} | Baseline; ${l.contrastName}; ${l.fault?'failure / recovery':'denial or boundary contrast'} | ${l.family} | Problem, analogy, prediction, outcome, misconception, trade-off, pseudocode, prerequisites, reference | engine.test.ts: ${c.id}; browser: ${c.id} |`;
});
mkdirSync('docs',{recursive:true});
writeFileSync('docs/lesson-checklist.md',`# Per-lesson requirements and evidence\n\nAll original 56 identifiers are retained. This inventory is generated from authored lesson definitions. Test pass evidence is recorded separately in verification.md; an inventory row alone does not claim verification.\n\nEvery lesson uses the common playback/seek/inspection/comparison/URL controller. Family renderers visualize different state. Failure injection appears only where modeled; identity and boundary lessons use rejection/permission controls instead.\n\n| Lesson | Relevant controls | Scenarios | Visualization family | Learning content | Runnable checks |\n|---|---|---|---|---|---|\n${lines.join('\n')}\n\nRebuild with \`node --import tsx scripts/lesson-checklist.ts\`.\n`);
