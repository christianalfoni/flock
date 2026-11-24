import { describe, expect, it } from "vitest";
import { speakable } from "./speakable";

describe("text as it is said", () => {
  it("says asides between commas", () => {
    expect(speakable("The worker (a Node process) takes the job.")).toBe("The worker, a Node process, takes the job.");
    expect(speakable("It retries (twice).")).toBe("It retries, twice.");
  });

  it("says symbols, versions, multipliers and units as words", () => {
    expect(speakable("API -> queue → worker")).toBe("API to queue to worker");
    expect(speakable("Redis & Postgres, e.g. for sessions")).toBe("Redis and Postgres, for example, for sessions");
    expect(speakable("read/write on v2, 10x faster")).toBe("read or write on version 2, 10 times faster");
    expect(speakable("It waits 500ms, then 2 s, for 3 MB at 90%.")).toBe("It waits 500 milliseconds, then 2 seconds, for 3 megabytes at 90 percent.");
    expect(speakable("Call `enqueue` vs. the old one")).toBe("Call enqueue versus the old one");
  });

  it("leaves a word with its phonemes as it is", () => {
    expect(speakable("Jobs wait (in [Redis](/ɹˈɛdɪs/)) for [stdout](/stˈændəɹd ˈWt/)/[stderr](/stˈændəɹd ˈɛɹəɹ/).")).toBe("Jobs wait, in [Redis](/ɹˈɛdɪs/), for [stdout](/stˈændəɹd ˈWt/)/[stderr](/stˈændəɹd ˈɛɹəɹ/).");
    expect(speakable("[v2](/vˈɜɹʒən tˈu/) is 10x faster")).toBe("[v2](/vˈɜɹʒən tˈu/) is 10 times faster");
  });

  it("leaves plain narration alone", () => {
    const plain = "A worker takes jobs off the queue, one at a time.";
    expect(speakable(plain)).toBe(plain);
  });
});
