import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const output = resolve(process.argv[2] ?? 'work/release');
await mkdir(output, { recursive: true });
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(commit) || (process.env.GITHUB_SHA && process.env.GITHUB_SHA !== commit)) throw new Error('Release must match the checked out commit');
const staging = await mkdtemp(join(output, '.package-'));
try {
  await cp('dist', join(staging, 'frontend'), { recursive: true });
  await mkdir(join(staging, 'backend'));
  for (const path of ['dist', 'package.json', 'package-lock.json', 'prisma', 'data']) {
    await cp(join('server', path), join(staging, 'backend', path), { recursive: true });
  }
  await cp('server/deploy/frontend/deploy-frontend.sh', join(staging, 'deploy-frontend.sh'));
  const manifest = { commit, branch: process.env.GITHUB_REF_NAME ?? execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim() };
  await writeFile(join(staging, 'manifest.json'), JSON.stringify(manifest) + '\n');
  await writeFile(join(staging, 'frontend/version.json'), JSON.stringify({ commit }) + '\n');
  const archive = join(output, 'release.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', staging, 'frontend', 'backend', 'manifest.json', 'deploy-frontend.sh']);
  const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(join(output, 'release.tar.gz.sha256'), `${digest}  release.tar.gz\n`);
  console.log(`Packaged verified source ${commit}: ${archive}`);
} finally { await rm(staging, { recursive: true, force: true }); }
