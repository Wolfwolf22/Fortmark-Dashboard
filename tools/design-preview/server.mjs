import { build } from "esbuild";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const folder = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(folder, "../..");
const dist = path.join(folder, "dist");
const port = Number(process.env.PREVIEW_PORT || 4173);
const aliases = new Map([
  ["next/link", "link.jsx"], ["next/image", "image.jsx"], ["next/navigation", "next-stubs.jsx"],
  ["@/components/profile/profile-drawer", "preview-dialogs.jsx"],
  ["@/components/layout/quick-create-dialog", "preview-dialogs.jsx"],
  ["@/lib/data/adapters/listings", "visual-adapters.mjs"],
  ["@/lib/data/adapters/transactions", "visual-adapters.mjs"],
  ["@/lib/data/adapters/agents", "visual-adapters.mjs"],
  ["@/lib/data/adapters/leads", "contact-adapters.mjs"],
]);
let currentBuild;
async function compile() {
  if (currentBuild) return currentBuild;
  currentBuild = (async () => {
    if (process.env.PREVIEW_DEBUG) process.stdout.write(`Compiling preview (${process.pid})\n`);
    await fs.mkdir(dist, { recursive: true });
    await build({
      entryPoints: [path.join(folder, "main.jsx")], outfile: path.join(dist, "app.js"), bundle: true,
      format: "esm", platform: "browser", jsx: "automatic", target: ["es2020"], sourcemap: true,
      tsconfig: path.join(repo, "tsconfig.json"), define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_APP_URL": '""', "process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL": '""' },
      plugins: [{ name: "isolated-preview", setup(builder) {
        builder.onResolve({ filter: /.*/ }, args => {
          if (process.env.PREVIEW_DEBUG) process.stdout.write(`Resolve ${args.path}\n`);
          if (aliases.has(args.path)) return { path: path.join(folder, aliases.get(args.path)) };
          if (args.path.startsWith("@/")) {
            const base = path.join(repo, args.path.slice(2));
            const resolved = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx"].map(suffix => base + suffix)].find(candidate => existsSync(candidate));
            if (!resolved) throw new Error(`Preview could not resolve ${args.path}`);
            return { path: resolved };
          }
          if (args.path.startsWith(".") || args.path.startsWith("/")) {
            const base = path.resolve(args.resolveDir || repo, args.path);
            const resolved = [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"].map(suffix => base + suffix)].find(candidate => existsSync(candidate));
            if (resolved) return { path: resolved };
          }
          return { path: createRequire(path.join(args.resolveDir || repo, "__preview__.js")).resolve(args.path) };
        });
      } }],
    });
    if (process.env.PREVIEW_DEBUG) process.stdout.write("Compiling styles\n");
    const result = spawnSync(process.execPath, [path.join(repo, "node_modules/tailwindcss/lib/cli.js"), "-c", path.join(repo, "tailwind.config.ts"), "-i", path.join(repo, "app/globals.css"), "-o", path.join(dist, "style.css"), "--content", "./app/**/*.{ts,tsx},./components/**/*.{ts,tsx},./lib/**/*.{ts,tsx},./tools/design-preview/*.jsx"], { cwd: repo, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || "Tailwind compilation failed");
    await fs.appendFile(path.join(dist, "style.css"), '\n@font-face{font-family:Archivo;src:url(/fonts/Archivo-Variable.woff2) format("woff2");font-weight:400 800;font-display:swap}@font-face{font-family:"Archivo Black";src:url(/fonts/ArchivoBlack-Regular.woff2) format("woff2");font-weight:400;font-display:swap}:root{--font-archivo:Archivo;--font-archivo-black:"Archivo Black"}\n');
  })().finally(() => currentBuild = null);
  return currentBuild;
}

const html = '<!doctype html><html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>FortMark · Design preview</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>';
function responsiveHtml(width, height, view, scenario) {
  const frameQuery = new URLSearchParams({ view, scenario }).toString();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FortMark · Responsive design review</title><style>
  *{box-sizing:border-box}body{margin:0;background:#d9d9d9;color:#111;font:13px system-ui,sans-serif}header{min-height:58px;background:white;border-bottom:1px solid #bbb;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 20px;position:sticky;top:0;z-index:2}strong{font-size:13px}label{display:flex;align-items:center;gap:8px}select,button{padding:6px 10px;border:1px solid #777;border-radius:4px;background:white;color:#111}button{cursor:pointer}button:hover{background:#eee}button:focus-visible{outline:2px solid #111;outline-offset:2px}main{padding:24px;width:max-content;min-width:100%;display:flex;justify-content:center}iframe{display:block;border:1px solid #777;width:${width}px;height:${height}px;background:black;flex:none;box-shadow:0 8px 32px #0002}span{color:#555;font-size:12px}@media(max-width:600px){header{gap:10px;padding:10px 12px}header span{display:none}main{padding:12px}}
  </style></head><body><header><strong>FortMark · Design review</strong>
  <label>Width <select id="width" aria-label="Preview width">${[320,390,768,1280,1440].map(w=>`<option value="${w}" ${w===width?"selected":""}>${w}px</option>`).join("")}</select></label>
  <label>Height <select id="height" aria-label="Preview height">${[568,720,844,1024,1180].map(h=>`<option value="${h}" ${h===height?"selected":""}>${h}px</option>`).join("")}</select></label>
  <button type="button" id="return-top">Return to top</button><span>Actual application in an isolated viewport. Sample data only.</span></header>
  <main><iframe title="FortMark dashboard design preview" src="/preview?${frameQuery}"></iframe></main><script>
  function setSize(dimension,value){document.querySelector('iframe').style[dimension]=value+'px';var url=new URL(window.location.href);url.searchParams.set(dimension,value);history.replaceState({},'',url)}
  document.getElementById('width').addEventListener('change',function(){setSize('width',this.value)});
  document.getElementById('height').addEventListener('change',function(){setSize('height',this.value)});
  document.getElementById('return-top').addEventListener('click',function(){document.querySelector('iframe').contentWindow.scrollTo(0,0);window.scrollTo(0,0)})
  </script></body></html>`;
}
const mime = { ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".map": "application/json" };

await compile();
createServer(async (request, response) => {
  try {
    if (request.method !== "GET") { response.writeHead(405); response.end("Read-only design preview"); return; }
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.includes("..")) { response.writeHead(400); response.end(); return; }
    if (pathname === "/responsive") {
      const requested = Number(url.searchParams.get("width"));
      const width = [320,390,768,1280,1440].includes(requested) ? requested : 390;
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); const requestedHeight = Number(url.searchParams.get("height"));
      const height = [568,720,844,1024,1180].includes(requestedHeight) ? requestedHeight : 844;
      const requestedView = url.searchParams.get("view") || "/";
      const view = /^\/(?:listings(?:\/[a-z0-9-]+)?|transactions|contacts|settings)?(?:\?[a-z0-9_%=,&-]*)?$/i.test(requestedView) ? requestedView : "/";
      const requestedScenario = url.searchParams.get("scenario");
      const scenario = ["unavailable", "empty", "conflict"].includes(requestedScenario) ? requestedScenario : "records";
      response.end(responsiveHtml(width, height, view, scenario)); return;
    }
    if (pathname === "/" || pathname === "/preview") {
      await compile();
      response.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-store" }); response.end(html); return;
    }
    const relative = pathname.replace(/^\/dashboard/, "").replace(/^\//, "");
    const asset = relative.startsWith("fonts/") ? path.join(repo, "lib", relative) : relative.startsWith("brand/") || relative.startsWith("photos/") ? path.join(repo, "public", relative) : path.join(dist, relative);
    const data = await fs.readFile(asset);
    response.writeHead(200, { "Content-Type": mime[path.extname(asset)] || "application/octet-stream", "Cache-Control": "no-store" }); response.end(data);
  } catch (error) { response.writeHead(500, { "Content-Type": "text/plain" }); response.end(String(error)); }
}).listen(port, "127.0.0.1", () => process.stdout.write(`FortMark design preview: http://127.0.0.1:${port}/preview\n`));
