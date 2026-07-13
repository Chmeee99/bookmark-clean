declare const require: (specifier: "node:test") => {
  test(name: string, callback: () => void): void;
};

const { test } = require("node:test");

test("Node discovers and executes the TypeScript smoke test", () => {
  if (2 + 2 !== 4) {
    throw new Error("basic arithmetic is broken");
  }
});
