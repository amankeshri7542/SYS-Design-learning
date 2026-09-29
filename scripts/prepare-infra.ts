import { writeFileSync } from "node:fs";
import { concepts } from "../src/lib/catalog";
import { getControl } from "../src/lib/simulation";
writeFileSync("infra/concepts.json",JSON.stringify(Object.fromEntries(concepts.map(c=>{const control=getControl(c);return [c.id,{min:control.min,max:control.max}];})),null,2)+"\n");
console.log(`Prepared validation bounds for ${concepts.length} concepts.`);
