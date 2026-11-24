import { CLIENT_EVENTS } from "@ttmi/model";
import { describe, expect, it } from "vitest";
import { PREP_BUCKETS, prepBucket } from "./prep";

describe("prepBucket", () => {
  it("puts a wait in its bucket, edges in the longer one", () => {
    expect(prepBucket(0)).toBe("under_5s");
    expect(prepBucket(4.9)).toBe("under_5s");
    expect(prepBucket(5)).toBe("5_15s");
    expect(prepBucket(29.9)).toBe("15_30s");
    expect(prepBucket(30)).toBe("30_60s");
    expect(prepBucket(90)).toBe("1_2m");
    expect(prepBucket(600)).toBe("over_2m");
  });

  it("counts only buckets the server accepts", () => {
    expect([...CLIENT_EVENTS.voice_prepared]).toEqual([...PREP_BUCKETS]);
  });
});
