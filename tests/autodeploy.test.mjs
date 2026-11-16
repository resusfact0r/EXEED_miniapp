import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const poll = fileURLToPath(new URL('../server/deploy/autodeploy/poll.sh', import.meta.url));
const sha = 'a'.repeat(40);
const exists = (path) => access(path).then(() => true, () => false);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'exeed-autodeploy-test-'));
  const bin = join(root, 'bin'); await mkdir(bin);
  const archive = join(root, 'artifact'); await writeFile(archive, 'verified CI artifact');
  const digest = createHash('sha256').update('verified CI artifact').digest('hex');
  await writeFile(join(bin, 'git'), '#!/bin/bash\nprintf "%s\\trefs/heads/feat/web-visual-catalog\\n" "$MOCK_SHA"\n', { mode: 0o755 });
  await writeFile(join(bin, 'curl'), `#!/bin/bash
set -eu
out=''; url=''
while (( $# )); do
  if [[ "$1" == --output ]]; then out=$2; shift 2; else url=$1; shift; fi
done
echo request >> "$MOCK_REQUESTS"
if [[ "$url" == *.sha256 ]]; then
  printf '%s  release.tar.gz\\n' "$MOCK_CHECKSUM" > "$out"
  printf '%s' "$MOCK_STATUS"
else cp "$MOCK_ARCHIVE" "$out"; fi
`, { mode: 0o755 });
  const apply = join(root, 'apply.sh');
  await writeFile(apply, '#!/bin/bash\nprintf "%s\\n" "$2" >> "$MOCK_APPLIED"\nexit "${MOCK_APPLY_EXIT:-0}"\n', { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, EXEED_DEPLOY_STATE_DIR: join(root, 'state'), EXEED_APPLY_SCRIPT: apply, EXEED_BRANCH: 'feat/web-visual-catalog', MOCK_SHA: sha, MOCK_CHECKSUM: digest, MOCK_STATUS: '200', MOCK_ARCHIVE: archive, MOCK_APPLIED: join(root, 'applied'), MOCK_REQUESTS: join(root, 'requests') };
  return { root, env, run: (extra = {}) => spawnSync('bash', [poll], { env: { ...env, ...extra }, encoding: 'utf8' }), cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('a branch without a verified CI artifact never changes the running version', async () => {
  const f = await fixture();
  try {
    const result = f.run({ MOCK_STATUS: '404' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Waiting for a verified CI release/);
    assert.equal(await exists(f.env.MOCK_APPLIED), false);
    assert.equal(await exists(join(f.env.EXEED_DEPLOY_STATE_DIR, 'current')), false);
  } finally { await f.cleanup(); }
});

test('a corrupted artifact is rejected before any deployment command', async () => {
  const f = await fixture();
  try {
    const result = f.run({ MOCK_CHECKSUM: 'b'.repeat(64) });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /checksum does not match/);
    assert.equal(await exists(f.env.MOCK_APPLIED), false);
    assert.equal(await exists(join(f.env.EXEED_DEPLOY_STATE_DIR, 'current')), false);
  } finally { await f.cleanup(); }
});

test('a verified artifact deploys once and subsequent polls leave it running', async () => {
  const f = await fixture();
  try {
    const first = f.run(); assert.equal(first.status, 0, first.stderr);
    assert.equal((await readFile(join(f.env.EXEED_DEPLOY_STATE_DIR, 'current'), 'utf8')).trim(), sha);
    const second = f.run(); assert.equal(second.status, 0, second.stderr);
    assert.equal((await readFile(f.env.MOCK_APPLIED, 'utf8')).trim(), sha);
    assert.equal((await readFile(f.env.MOCK_REQUESTS, 'utf8')).trim().split('\n').length, 2);
  } finally { await f.cleanup(); }
});

test('an unsuccessful application install does not mark the candidate as deployed', async () => {
  const f = await fixture();
  try {
    const result = f.run({ MOCK_APPLY_EXIT: '12' });
    assert.equal(result.status, 12);
    assert.equal(await exists(join(f.env.EXEED_DEPLOY_STATE_DIR, 'current')), false);
  } finally { await f.cleanup(); }
});
