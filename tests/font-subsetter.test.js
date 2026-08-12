const assert = require("node:assert/strict");
const test = require("node:test");

const {
  collectFontCharacters,
  createFontPlan,
  createPyftsubsetArgs,
} = require("../lib/font-subsetter");

test("collects characters by computed font family", () => {
  const characters = collectFontCharacters({
    htmlContents: [
      '<div class="serif">甲乙<span class="sans">丙甲</span>丁</div>' +
        '<section class="panel"><strong>戊己戊</strong></section>',
    ],
    cssFiles: [
      {
        content: [
          '.serif{font-family:"Serif"}',
          '.sans{font-family:"Sans"}',
          '.panel strong{font-family:"Serif"}',
        ].join(""),
      },
    ],
    fontFamilies: new Set(["Serif", "Sans", "Unused"]),
  });

  assert.deepEqual(characters, {
    Serif: "甲乙丁戊己",
    Sans: "丙甲",
    Unused: "",
  });
});

test("collects characters from child combinator selectors", () => {
  const characters = collectFontCharacters({
    htmlContents: [
      '<nav class="navigation"><a><span>导航文字</span></a></nav>',
    ],
    cssFiles: [
      {
        content: '.navigation>a{font-family:"Nav"}',
      },
    ],
    fontFamilies: new Set(["Nav"]),
  });

  assert.equal(characters.Nav, "导航文字");
});

test("plans only locally referenced TTF fonts", () => {
  const plan = createFontPlan({
    fontDir: "C:\\project\\dist\\font",
    cssFiles: [
      {
        content: [
          "@font-face{font-family:Local;src:url(../font/local.ttf)}",
          "@font-face{font-family:Remote;src:url(https://cdn.test/remote.ttf)}",
        ].join(""),
      },
    ],
    ttfFiles: ["local.ttf", "remote.ttf", "unused.ttf"],
  });

  assert.deepEqual(Array.from(plan.localFontNames), ["local"]);
  assert.deepEqual(Array.from(plan.remoteFontNames), ["remote"]);
  assert.deepEqual(plan.ttfFilesToSubset, [
    "C:\\project\\dist\\font\\local.ttf",
  ]);
});

test("maps CSS family names to their font files", () => {
  const plan = createFontPlan({
    fontDir: "C:\\project\\dist\\font",
    cssFiles: [
      {
        content:
          '@font-face{font-family:"Display Serif";src:url(../font/display.ttf)}',
      },
    ],
    ttfFiles: ["display.ttf"],
  });

  assert.equal(plan.fontFamilyByName.get("display"), "Display Serif");
});

test("passes a manifest path instead of inline Unicode", () => {
  const args = createPyftsubsetArgs({
    fontPath: "C:\\project\\dist\\font\\local.ttf",
    outputPath: "C:\\project\\dist\\font\\local-subset.woff2",
    textPath: "C:\\project\\font\\local.txt",
    flavor: "woff2",
  });

  assert.deepEqual(args, [
    "C:\\project\\dist\\font\\local.ttf",
    "--output-file=C:\\project\\dist\\font\\local-subset.woff2",
    "--text-file=C:\\project\\font\\local.txt",
    "--layout-features=*",
    "--flavor=woff2",
  ]);
  assert.equal(
    args.some((arg) => arg.startsWith("--unicodes=")),
    false,
  );
});
