01:36:20.003 
Running build in Washington, D.C., USA (East) – iad1
01:36:20.004 
Build machine configuration: 2 cores, 8 GB
01:36:20.122 
Cloning github.com/Dominioproprio/dominio-pro-auto-clone (Branch: main, Commit: 4932b28)
01:36:20.401 
Cloning completed: 279.000ms
01:36:20.925 
Restored build cache from previous deployment (4xj2wtCY3bb37cjJNbpxmLHVHYLv)
01:36:21.274 
Running "vercel build"
01:36:21.862 
Vercel CLI 50.38.2
01:36:22.436 
Running "install" command: `npm install --legacy-peer-deps`...
01:36:25.065 
01:36:25.065 
up to date, audited 661 packages in 2s
01:36:25.065 
01:36:25.066 
167 packages are looking for funding
01:36:25.066 
  run `npm fund` for details
01:36:25.085 
01:36:25.086 
13 vulnerabilities (3 moderate, 10 high)
01:36:25.086 
01:36:25.086 
To address issues that do not require attention, run:
01:36:25.087 
  npm audit fix
01:36:25.087 
01:36:25.087 
To address all issues possible (including breaking changes), run:
01:36:25.087 
  npm audit fix --force
01:36:25.087 
01:36:25.088 
Some issues need review, and may require choosing
01:36:25.088 
a different dependency.
01:36:25.088 
01:36:25.088 
Run `npm audit` for details.
01:36:25.317 
01:36:25.317 
> dominio-pro@2.0.0 build
01:36:25.318 
> vite build && esbuild server/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
01:36:25.318 
01:36:25.683 
vite v7.3.1 building client environment for production...
01:36:25.770 
transforming...
01:36:30.390 
✓ 3316 modules transformed.
01:36:30.395 
✗ Build failed in 4.68s
01:36:30.396 
error during build:
01:36:30.396 
client/src/components/AgentChat.tsx (8:9): "executarAgente" is not exported by "client/src/lib/ai-agent.ts", imported by "client/src/components/AgentChat.tsx".
01:36:30.396 
file: /vercel/path0/client/src/components/AgentChat.tsx:8:9
01:36:30.396 
01:36:30.397 
6: import { Input } from "@/components/ui/input";
01:36:30.397 
7: import { ScrollArea } from "@/components/ui/scroll-area";
01:36:30.397 
8: import { executarAgente } from "@/lib/ai-agent";
01:36:30.397 
            ^
01:36:30.398 
9: import { supabase } from "@/lib/supabase";
01:36:30.398 
01:36:30.398 
    at getRollupError (file:///vercel/path0/node_modules/rollup/dist/es/shared/parseAst.js:402:41)
01:36:30.398 
    at error (file:///vercel/path0/node_modules/rollup/dist/es/shared/parseAst.js:398:42)
01:36:30.398 
    at Module.error (file:///vercel/path0/node_modules/rollup/dist/es/shared/node-entry.js:17040:16)
01:36:30.398 
    at Module.traceVariable (file:///vercel/path0/node_modules/rollup/dist/es/shared/node-entry.js:17452:29)
01:36:30.399 
    at ModuleScope.findVariable (file:///vercel/path0/node_modules/rollup/dist/es/shared/node-entry.js:15070:39)
Deployment Summary
