const esbuild = require("esbuild");
const JavaScriptObfuscator = require("javascript-obfuscator");
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "dist");

function cleanDist() {
if (fs.existsSync(dist)) {
fs.rmSync(dist, {
recursive: true,
force: true
});
}

fs.mkdirSync(dist, {
    recursive: true
});

}

function obfuscateFile(filePath) {
console.log("Obfuscating " + path.basename(filePath) + "...");

const source = fs.readFileSync(filePath, "utf8");

const result = JavaScriptObfuscator.obfuscate(source, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.15,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 8,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ["base64"],
    stringArrayIndexShift: true,
    stringArrayRotate: true,
    stringArrayShuffle: true,
    stringArrayWrappersCount: 2,
    stringArrayWrappersChainedCalls: true,
    stringArrayWrappersParametersMaxCount: 4,
    stringArrayWrappersType: "function",
    stringArrayThreshold: 0.75,
    transformObjectKeys: true,
    unicodeEscapeSequence: false
});

fs.writeFileSync(
    filePath,
    result.getObfuscatedCode(),
    "utf8"
);

}

async function buildJavaScript(entryPoint, outputName) {
console.log("Building " + entryPoint + "...");

const outputPath = path.join(
    dist,
    outputName
);

await esbuild.build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    external: [
        "https://www.gstatic.com/*"
    ],
    outfile: outputPath
});

obfuscateFile(outputPath);

}

async function buildCSS() {
console.log("Building CSS...");

let styleCSS = fs.readFileSync(
    path.join(__dirname, "style.css"),
    "utf8"
);

let ballDropCSS = fs.readFileSync(
    path.join(__dirname, "ball-drop.css"),
    "utf8"
);

styleCSS = styleCSS
    .replace(
        /url\(\s*(['"]?)images\//g,
        "url($1../images/"
    )
    .replace(
        /url\(\s*(['"]?)sounds\//g,
        "url($1../sounds/"
    );

ballDropCSS = ballDropCSS
    .replace(
        /url\(\s*(['"]?)images\//g,
        "url($1../images/"
    )
    .replace(
        /url\(\s*(['"]?)sounds\//g,
        "url($1../sounds/"
    );

const combinedCSS =
    styleCSS +
    "\n" +
    ballDropCSS;

const tempCSS = path.join(
    dist,
    "_combined.css"
);

fs.writeFileSync(
    tempCSS,
    combinedCSS,
    "utf8"
);

await esbuild.build({
    entryPoints: [tempCSS],
    bundle: true,
    minify: true,
    sourcemap: false,
    legalComments: "none",
    loader: {
        ".css": "css"
    },
    external: [
        "../images/*",
        "../sounds/*"
    ],
    outfile: path.join(
        dist,
        "styles.css"
    )
});

fs.rmSync(tempCSS, {
    force: true
});

}

async function build() {
console.log("");
console.log("========================================");
console.log("       PERYA DICE ONLINE BUILD");
console.log("========================================");
console.log("");

cleanDist();

await buildJavaScript(
    "script.js",
    "app.js"
);

await buildJavaScript(
    "ball-drop.js",
    "game.js"
);

await buildJavaScript(
    "presence.js",
    "presence.js"
);

await buildCSS();

console.log("");
console.log("========================================");
console.log("          BUILD COMPLETED");
console.log("========================================");
console.log("");

const files = fs.readdirSync(dist);

console.log("Generated files:");

for (const file of files) {
    const filePath = path.join(
        dist,
        file
    );

    const size = fs.statSync(filePath).size;

    console.log(
        "  " +
        file +
        " - " +
        size.toLocaleString() +
        " bytes"
    );
}

console.log("");

}

build().catch(function(error) {
console.log("");
console.log("========================================");
console.log("             BUILD FAILED");
console.log("========================================");
console.log("");

console.error(error);

process.exit(1);

});
