// Gera o build do painel do provider (apps/provider-panel) e copia para public/painel,
// de onde o site o serve em /painel/ e o embute na seção "Seja provider".
import { execSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const panel = resolve(here, '../../provider-panel');
const out = resolve(here, '../public/painel');
const run = cmd => execSync(cmd, { cwd: panel, stdio: 'inherit' });

if (!existsSync(resolve(panel, 'node_modules'))) run('npm ci');
run('npm run build');
rmSync(out, { recursive: true, force: true });
cpSync(resolve(panel, 'dist'), out, { recursive: true });
console.log('painel copiado para public/painel');
