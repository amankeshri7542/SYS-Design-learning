import { simulate, validateInput } from "@/lib/simulation";
import { readJson } from "@/lib/request";
export async function POST(request: Request) {
  try { return Response.json(simulate(validateInput(await readJson(request)))); }
  catch (error) {
    const message=error instanceof Error?error.message:"Invalid simulation.";
    return Response.json({error:message},{status:message==="Request is too large."?413:400});
  }
}
