import { getLesson } from "../lessons";
import { Timeline, validateConfig, finish, type Config } from "./model";
import { cache, fleet, queue } from "./traffic";
import { replicas, records, hashing, identity, network } from "./data";
import { circuit, workflow } from "./workflows";

export function runExperiment(raw: Config) {
  const config = validateConfig(raw),
    t = new Timeline(config);
  const execute = {
    cache,
    fleet,
    queue,
    replica: replicas,
    record: records,
    hash: hashing,
    identity,
    network,
    circuit,
    workflow,
  };
  execute[getLesson(config.lesson).family](t);
  return finish(t);
}
export * from "./model";
