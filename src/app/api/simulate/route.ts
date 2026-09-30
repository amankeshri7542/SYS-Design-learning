import { runExperiment } from "@/lib/engine";
import { simulate, validateInput } from "@/lib/simulation";
import { readJson } from "@/lib/request";
export async function POST(request: Request) {
  try {
    const raw = await readJson(request);
    return Response.json(
      raw && typeof raw === "object" && "version" in raw
        ? runExperiment(raw as Parameters<typeof runExperiment>[0])
        : simulate(validateInput(raw)),
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Invalid simulation.";
    return Response.json(
      { error: message },
      { status: message === "Request is too large." ? 413 : 400 },
    );
  }
}
