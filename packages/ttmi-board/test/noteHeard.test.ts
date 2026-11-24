// A note the voice names opens for that stop only (docs/board.md, Notes fold).
// The same pointing arriving again, after the stop has changed, does not
// open it: that is the note's own measurement, or a cue from the stop left.
import { describe, expect, it } from "vitest";
import { cameraFollows, noteHeard, type HeardCursor, type HeardNote } from "../src/noteHeard";

const at = (playing: number | undefined, pointing: string | undefined): HeardCursor => ({ playing, pointing });

function hear(previous: HeardCursor, playing: number | undefined, pointing: string | undefined, said: HeardNote | undefined, isNote = true) {
  return noteHeard({ playing, pointing, isNote, previous, said });
}

describe("a note the voice names", () => {
  it("opens when the voice starts naming it, and stays open while that naming is repeated", () => {
    const opened = hear(at(undefined, undefined), 0, "capture", undefined);
    expect(opened.said).toEqual({ step: 0, name: "capture" });
    const again = hear(opened.previous, 0, "capture", opened.said);
    expect(again.said).toEqual({ step: 0, name: "capture" });
  });

  it("folds it when the stop changes, even if the previous naming is still set", () => {
    const opened = hear(at(undefined, undefined), 0, "capture", undefined);
    const left = hear(opened.previous, 1, "capture", opened.said);
    expect(left.said).toBeUndefined();
  });

  it("does not open it again when that naming is heard once more after the stop changed", () => {
    const opened = hear(at(undefined, undefined), 0, "capture", undefined);
    const left = hear(opened.previous, 1, "capture", opened.said);
    // The open note's measurement, or a cue from the stop just left.
    const late = hear(left.previous, 1, "capture", left.said);
    expect(late.said).toBeUndefined();
  });

  it("opens a note the new stop's voice names, and one named in the same moment the stop changes", () => {
    const opened = hear(at(undefined, undefined), 0, "capture", undefined);
    const left = hear(opened.previous, 1, undefined, opened.said);
    const named = hear(left.previous, 1, "other", left.said);
    expect(named.said).toEqual({ step: 1, name: "other" });
    const jumped = hear(named.previous, 2, "third", named.said);
    expect(jumped.said).toEqual({ step: 2, name: "third" });
  });

  it("folds every note when the walkthrough leaves the stops, and ignores a pointing that is not a note", () => {
    const opened = hear(at(undefined, undefined), 0, "capture", undefined);
    expect(hear(opened.previous, undefined, "capture", opened.said).said).toBeUndefined();
    expect(hear(at(1, undefined), 1, "queue", undefined, false).said).toBeUndefined();
  });
});

function follow(followed: HeardCursor, playing: number | undefined, pointing: string | undefined) {
  return cameraFollows({ playing, pointing, followed });
}

describe("the camera and a pointing", () => {
  it("follows a note the voice names, and again when that note is measured", () => {
    const opened = follow(at(undefined, undefined), 0, "capture");
    expect(opened.follow).toBe(true);
    expect(follow(opened.followed, 0, "capture").follow).toBe(true);
  });

  it("does not follow a pointing carried from the previous stop, not when the note is measured as it folds", () => {
    const opened = follow(at(undefined, undefined), 0, "capture");
    const left = follow(opened.followed, 1, "capture");
    expect(left.follow).toBe(false);
    expect(left.followed).toEqual(opened.followed);
    expect(follow(left.followed, 1, "capture").follow).toBe(false);
  });

  it("follows a pointing the new stop starts, including the same name once the carried one has cleared", () => {
    const opened = follow(at(undefined, undefined), 0, "capture");
    const left = follow(opened.followed, 1, "capture");
    const cleared = follow(left.followed, 1, undefined);
    expect(cleared.follow).toBe(false);
    expect(cleared.followed).toEqual({ playing: 1, pointing: undefined });
    expect(follow(cleared.followed, 1, "worker").follow).toBe(true);
    expect(follow(cleared.followed, 1, "capture").follow).toBe(true);
  });

  it("follows a pointing that arrives in the same moment the stop changes", () => {
    const opened = follow(at(undefined, undefined), 0, "capture");
    const jumped = follow(opened.followed, 2, "third");
    expect(jumped.follow).toBe(true);
    expect(jumped.followed).toEqual({ playing: 2, pointing: "third" });
  });

  it("follows nothing once the walkthrough leaves the stops", () => {
    const opened = follow(at(undefined, undefined), 0, "capture");
    const stopped = follow(opened.followed, undefined, "capture");
    expect(stopped.follow).toBe(false);
    expect(stopped.followed).toEqual({ playing: undefined, pointing: undefined });
  });
});
