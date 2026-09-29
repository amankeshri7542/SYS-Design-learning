import { validateInput } from "@/lib/simulation";
import { readJson } from "@/lib/request";
export const dynamic = "force-dynamic";
async function forward(request:Request) {
  const base=process.env.AWS_LAB_API_URL;
  if(!base) return Response.json({error:"AWS progress sync is not configured."},{status:503});
  const authorization=request.headers.get("authorization");
  if(!authorization || !/^Bearer [A-Za-z0-9._-]{20,8192}$/.test(authorization)) return Response.json({error:"Sign in to sync progress."},{status:401});
  let body:string|undefined;
  if(request.method==="POST") {
    try {body=JSON.stringify(validateInput(await readJson(request)));}
    catch {return Response.json({error:"Invalid progress record."},{status:400});}
  }
  try {
    const url=new URL(`${base.replace(/\/$/,"")}/progress`);
    if(url.protocol!=="https:") throw new Error("HTTPS required");
    const response=await fetch(url,{method:request.method,headers:{Authorization:authorization,"Content-Type":"application/json"},body,cache:"no-store",signal:AbortSignal.timeout(8000),redirect:"error"});
    if(!response.ok) return Response.json({error:response.status===401||response.status===403?"Sign in again to sync progress.":"Cloud sync is temporarily unavailable."},{status:[401,403,429].includes(response.status)?response.status:502});
    return Response.json(await response.json(),{headers:{"Cache-Control":"no-store"}});
  }catch{return Response.json({error:"Cloud sync is temporarily unavailable."},{status:502});}
}
export const GET=forward;
export const POST=forward;
