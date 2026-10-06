import { test } from "node:test";
import assert from "node:assert/strict";
import { greetingForHour, greet } from "@/lib/greeting";

test("greetingForHour covers the day in non-overlapping bands", () => {
  assert.equal(greetingForHour(5), "Good morning");
  assert.equal(greetingForHour(11), "Good morning");
  assert.equal(greetingForHour(12), "Good afternoon");
  assert.equal(greetingForHour(16), "Good afternoon");
  assert.equal(greetingForHour(17), "Good evening");
  assert.equal(greetingForHour(21), "Good evening");
  assert.equal(greetingForHour(22), "Working late");
  assert.equal(greetingForHour(2), "Working late");
});

test("greet appends only the first name", () => {
  assert.equal(greet(9, "Ayantik Sarkar"), "Good morning, Ayantik");
});

test("greet falls back to no name when none is given", () => {
  assert.equal(greet(9, null), "Good morning");
  assert.equal(greet(9, undefined), "Good morning");
  assert.equal(greet(9, "   "), "Good morning");
});
