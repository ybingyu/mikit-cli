"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");

const {
  collectRuntimeFontCharacters,
} = require("../lib/font-runtime-collector");

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function main() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
<head>
  <style>
    @font-face { font-family: Display; src: local("Arial"); }
    body { font-family: Display; }
  </style>
</head>
<body>
  <div id="app"></div>
  <div style="display:none">隐藏字符</div>
  <script>
    const mode = new URL(location.href).searchParams.get("o");
    document.querySelector("#app").textContent =
      mode === "1" ? "300元京东E卡" : "溯月至臻圣器匣[绑]";
  </script>
</body>
</html>`);
  });

  try {
    const port = await listen(server);
    const result = await collectRuntimeFontCharacters({
      pages: [
        `http://127.0.0.1:${port}/index.shtml?o=1`,
        `http://127.0.0.1:${port}/index.shtml?o=2`,
      ],
      waitFor: "#app",
      wait: 0,
      timeout: 5000,
      browserExecutable: null,
      fontFamilies: ["Display"],
    });

    assert.equal(
      result.Display,
      "300元京东E卡隐藏字符溯月至臻圣器匣[绑]",
    );
    console.log("font runtime smoke passed");
  } finally {
    if (server.listening) {
      await close(server);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
