import { test } from "node:test";
import assert from "node:assert/strict";
import { ciOf, stateOf } from "./pullRequestStatus.ts";

test("CI from a pull request's checks", () => {
  assert.equal(ciOf(undefined), "unknown");
  assert.equal(ciOf([]), "unknown");
  assert.equal(ciOf([{ status: "COMPLETED", conclusion: "SUCCESS" }, { status: "COMPLETED", conclusion: "SKIPPED" }]), "passing");
  assert.equal(ciOf([{ status: "IN_PROGRESS", conclusion: "" }, { status: "COMPLETED", conclusion: "SUCCESS" }]), "pending");
  // A failure is failing even while other checks still run.
  assert.equal(ciOf([{ status: "IN_PROGRESS" }, { status: "COMPLETED", conclusion: "FAILURE" }]), "failing");
  // Commit statuses carry a state instead.
  assert.equal(ciOf([{ state: "PENDING" }]), "pending");
  assert.equal(ciOf([{ state: "ERROR" }]), "failing");
  assert.equal(ciOf([{ state: "SUCCESS" }]), "passing");
});

test("a pull request's state", () => {
  assert.equal(stateOf({ state: "MERGED", isDraft: false }), "merged");
  assert.equal(stateOf({ state: "CLOSED", isDraft: false }), "closed");
  assert.equal(stateOf({ state: "OPEN", isDraft: true, mergeable: "CONFLICTING" }), "draft");
  assert.equal(stateOf({ state: "OPEN", isDraft: false, mergeable: "CONFLICTING" }), "conflict");
  assert.equal(stateOf({ state: "OPEN", isDraft: false, mergeable: "UNKNOWN" }), "open");
});
