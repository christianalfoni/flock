import { describe, expect, it } from "vitest";
import { backoffDelay, hostedRanks, HOSTED_CONCURRENCY, HostedQueue, nestedRank } from "./schedule";

describe("hosted voice order", () => {
  it("plays the step in focus first, then the ones after it", () => {
    expect(hostedRanks(5, 0)).toEqual([0, 1, 2, 3, 4]);
  });

  it("re-prioritizes when the reader jumps, so the new step and the ones after it go first", () => {
    expect(hostedRanks(5, 2)).toEqual([5, 6, 0, 1, 2]);
    const queue = new HostedQueue(HOSTED_CONCURRENCY, () => 0);
    hostedRanks(4, 0).forEach((rank, index) => queue.upsert(`s${index}`, rank));
    expect(queue.take()).toEqual(["s0", "s1"]);
    hostedRanks(4, 3).forEach((rank, index) => queue.upsert(`s${index}`, rank));
    queue.done("s0");
    expect(queue.take()).toEqual(["s3"]);
  });

  it("puts a nested canvas's first step after this sketch, and its later steps after that", () => {
    expect(nestedRank(4, 0, 2, 0)).toBe(5);
    expect(nestedRank(4, 1, 2, 0)).toBe(6);
    expect(nestedRank(4, 0, 2, 1)).toBeGreaterThan(nestedRank(4, 1, 2, 0));
  });

  it("never runs more than the cap", () => {
    const queue = new HostedQueue(2, () => 0);
    for (let index = 0; index < 5; index++) queue.upsert(`s${index}`, index);
    expect(queue.take()).toEqual(["s0", "s1"]);
    expect(queue.take()).toEqual([]);
    expect(queue.running.size).toBe(2);
  });

  it("waits out a 429 before asking again, and gives up after five", () => {
    let now = 1_000;
    const queue = new HostedQueue(1, () => now);
    queue.upsert("busy", 0);
    queue.upsert("next", 1);
    expect(queue.take()).toEqual(["busy"]);
    const delay = queue.backoff("busy", 0);
    expect(delay).toBe(backoffDelay(0, 0));
    expect(queue.take()).toEqual(["next"]);
    expect(queue.take()).toEqual([]);
    now += delay!;
    queue.done("next");
    expect(queue.take()).toEqual(["busy"]);
    for (let attempt = 0; attempt < 5; attempt++) queue.backoff("busy", 0);
    expect(queue.backoff("busy", 0)).toBeUndefined();
  });
});
