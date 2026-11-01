import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HEDGE_MS,
  MAX_CATALOG,
  MAX_ID_CHARS,
  MAX_NAME_CHARS,
  MAX_STOREID_CHARS,
  MAX_TERMS,
  MAX_TERM_CHARS,
  RESOLVE_TIMEOUT_MS,
  Resolve400,
  cleanAnswers,
  validateResolveRequest,
} from "./resolve.ts";
import { HEB_CATALOG } from "./catalogs/heb-001.ts";
import {
  RESOLVE_PROMPT,
  RESOLVE_PROMPT_V1,
  RESOLVE_PROMPT_V2,
} from "./resolve-contract.ts";

const tiny = [{ id: "a", name: "Apples" }];

function bad(body: unknown, part: string): void {
  assert.throws(() => validateResolveRequest(body), (e: unknown) => {
    assert.ok(e instanceof Resolve400);
    assert.ok(e.message.includes(part), `400 message "${e.message}" lacks "${part}"`);
    return true;
  });
}

describe("validateResolveRequest", () => {
  it("uses the bundled catalog for heb-001 and ignores a client catalog", () => {
    const out = validateResolveRequest({
      storeId: "heb-001",
      terms: ["cerial"],
      catalog: [{ id: "x".repeat(999), name: "junk" }],
    });
    assert.equal(out.storeId, "heb-001");
    assert.deepEqual(out.terms, ["cerial"]);
    assert.equal(out.catalog.length, 183);
    assert.ok(out.catalog.some((c) => c.id === "cereal"));
  });

  it("accepts a client catalog for unknown stores", () => {
    const out = validateResolveRequest({
      storeId: "future-001",
      terms: ["milk"],
      catalog: tiny,
    });
    assert.deepEqual(out.catalog, tiny);
  });

  it("rejects bad shapes with clear 400s", () => {
    bad(null, "JSON object");
    bad({ storeId: "heb-001" }, "terms must be");
    bad({ storeId: "heb-001", terms: [] }, "terms must be");
    bad({ storeId: "heb-001", terms: Array(MAX_TERMS + 1).fill("x") }, "1–30");
    bad({ storeId: "heb-001", terms: ["  "] }, "non-empty string");
    bad({ storeId: "heb-001", terms: ["x".repeat(MAX_TERM_CHARS + 1)] }, "exceeds 60");
    bad({ storeId: "heb-001", terms: ["!!!"] }, "no searchable text");
    bad({ storeId: "", terms: ["x"] }, "storeId");
    bad({ storeId: "x".repeat(MAX_STOREID_CHARS + 1), terms: ["x"] }, "storeId");
    bad({ storeId: "future-001", terms: ["x"] }, "include catalog");
    bad(
      { storeId: "future-001", terms: ["x"], catalog: Array(MAX_CATALOG + 1).fill(tiny[0]) },
      "1–500",
    );
    bad(
      { storeId: "future-001", terms: ["x"], catalog: [{ id: "x".repeat(MAX_ID_CHARS + 1), name: "n" }] },
      "catalog[0].id",
    );
    bad(
      { storeId: "future-001", terms: ["x"], catalog: [{ id: "i", name: "n".repeat(MAX_NAME_CHARS + 1) }] },
      "catalog[0].name",
    );
  });
});

describe("cleanAnswers", () => {
  const catalog = [
    { id: "cereal", name: "Cereal" },
    { id: "milk", name: "Milk" },
  ];

  it("drops invented ids; all-invented becomes clarify", () => {
    const { answers, learnedAliases } = cleanAnswers(
      {
        answers: [
          {
            input: "cerial",
            matches: [
              { productId: "cereal", confidence: 0.9 },
              { productId: "made-up", confidence: 0.8 },
            ],
            needsClarification: false,
            question: "",
            options: [],
          },
          {
            input: "asdfgh",
            matches: [{ productId: "nope", confidence: 0.9 }],
            needsClarification: false,
            question: "",
            options: [],
          },
        ],
      },
      catalog,
    );
    assert.deepEqual(answers[0]!.matches, [{ productId: "cereal", confidence: 0.9 }]);
    assert.equal(answers[0]!.needsClarification, false);
    assert.deepEqual(answers[1]!.matches, []);
    assert.equal(answers[1]!.needsClarification, true);
    assert.ok(answers[1]!.question.length > 0);
    assert.deepEqual(learnedAliases, [
      { term: "cerial", productId: "cereal", confidence: 0.9 },
    ]);
  });

  it("leaves honest empty answers (not sold) alone", () => {
    const { answers, learnedAliases } = cleanAnswers(
      {
        answers: [{
          input: "unicorn steak",
          matches: [],
          needsClarification: false,
          question: "",
          options: [],
        }],
      },
      catalog,
    );
    assert.equal(answers[0]!.needsClarification, false);
    assert.deepEqual(learnedAliases, []);
  });

  it("learns only confident non-clarify top matches, deduped by term", () => {
    const { learnedAliases } = cleanAnswers(
      {
        answers: [
          {
            input: "mayo",
            matches: [{ productId: "milk", confidence: 0.7 }],
            needsClarification: false,
            question: "",
            options: [],
          },
          {
            input: "cheese",
            matches: [{ productId: "milk", confidence: 0.95 }],
            needsClarification: true,
            question: "Which?",
            options: ["Milk"],
          },
          {
            input: "milk",
            matches: [{ productId: "milk", confidence: 0.99 }],
            needsClarification: false,
            question: "",
            options: [],
          },
          {
            input: "MILK",
            matches: [{ productId: "milk", confidence: 0.99 }],
            needsClarification: false,
            question: "",
            options: [],
          },
        ],
      },
      catalog,
    );
    assert.deepEqual(learnedAliases, [
      { term: "milk", productId: "milk", confidence: 0.99 },
    ]);
  });

  it("bundled heb-001 catalog matches the live store (183 products)", () => {
    assert.equal(HEB_CATALOG.length, 183);
    assert.ok(HEB_CATALOG.some((c) => c.id === "cereal" && c.name === "Cereal"));
  });

  it("pins the tuned /resolve timeout and hedge (§10)", () => {
    assert.equal(RESOLVE_TIMEOUT_MS, 30_000);
    assert.equal(HEDGE_MS, 12_000);
  });
});

describe("resolve prompt versions", () => {
  const tiny = [{ id: "a", name: "Apples" }];

  it("v1 stays frozen for comparison", () => {
    assert.equal(RESOLVE_PROMPT_V1.version, "resolve-v1");
    assert.ok(!RESOLVE_PROMPT_V1.system.includes("Pharmacy"));
    assert.ok(!RESOLVE_PROMPT_V1.user(["x"], tiny).includes("Pharmacy"));
  });

  it("v1 is current; v2 stays as a parked experiment", () => {
    assert.equal(RESOLVE_PROMPT, RESOLVE_PROMPT_V1);
    assert.equal(RESOLVE_PROMPT_V2.version, "resolve-v2");
    const text = RESOLVE_PROMPT_V2.system + "\n" + RESOLVE_PROMPT_V2.user(["x"], tiny);
    assert.ok(text.includes("prescription counter only"));
    assert.ok(text.includes("ask only when genuinely ambiguous"));
    assert.ok(text.includes("translate common Spanish grocery words"));
    assert.ok(text.includes("fresh staples from their departments"));
    // general rules only: no test-case answers hardcoded
    for (const leak of ["frijoles", "advil", "Dog Food", "Goya", "Tortillas"]) {
      assert.ok(!text.includes(leak), `v2 must not hardcode "${leak}"`);
    }
  });
});
