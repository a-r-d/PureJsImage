import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInTrialDirectory, snapshotWorkingTree } from '../benchmark/hillclimb/trees.ts'

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(os.tmpdir(), 'purejsimage-hillclimb-trees-'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

const git = (repository: string, args: readonly string[]): string =>
  execFileSync(
    'git',
    [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@localhost',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'init.defaultBranch=main',
      ...args,
    ],
    { cwd: repository, encoding: 'utf8' },
  ).trim()

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

describe('benchmark hillclimb trees', () => {
  it('snapshots the working tree without changing the checkout', async () => {
    const repository = join(directory, 'repository')
    await mkdir(repository)
    git(repository, ['init', '--quiet'])
    await writeFile(join(repository, '.gitignore'), 'ignored.txt\nnode_modules/\n')
    await writeFile(join(repository, 'modified.txt'), 'before\n')
    await writeFile(join(repository, 'deleted.txt'), 'delete me\n')
    await writeFile(join(repository, 'staged.txt'), 'before\n')
    git(repository, ['add', '--all'])
    git(repository, ['commit', '--quiet', '-m', 'initial'])

    await writeFile(join(repository, 'modified.txt'), 'after\n')
    await unlink(join(repository, 'deleted.txt'))
    await writeFile(join(repository, 'staged.txt'), 'staged\n')
    git(repository, ['add', 'staged.txt'])
    await writeFile(join(repository, 'untracked.txt'), 'new\n')
    await writeFile(join(repository, 'ignored.txt'), 'ignored\n')
    await mkdir(join(directory, 'shared-node-modules'))
    await symlink(join(directory, 'shared-node-modules'), join(repository, 'node_modules'), 'dir')
    const head = git(repository, ['rev-parse', 'HEAD'])
    const status = git(repository, ['status', '--porcelain'])

    const snapshot = await snapshotWorkingTree(repository, join(directory, 'snapshot.index'))

    expect(git(repository, ['ls-tree', '-r', '--name-only', snapshot]).split('\n')).toEqual([
      '.gitignore',
      'modified.txt',
      'staged.txt',
      'untracked.txt',
    ])
    expect(git(repository, ['show', `${snapshot}:modified.txt`])).toBe('after')
    expect(git(repository, ['show', `${snapshot}:staged.txt`])).toBe('staged')
    expect(git(repository, ['rev-parse', `${snapshot}^`])).toBe(head)
    expect(git(repository, ['rev-parse', 'HEAD'])).toBe(head)
    expect(git(repository, ['status', '--porcelain'])).toBe(status)
  })

  it('snapshots a checkout whose node_modules is an ignored directory', async () => {
    const repository = join(directory, 'installed')
    await mkdir(repository)
    git(repository, ['init', '--quiet'])
    await writeFile(join(repository, '.gitignore'), 'node_modules/\n')
    await writeFile(join(repository, 'source.txt'), 'before\n')
    git(repository, ['add', '--all'])
    git(repository, ['commit', '--quiet', '-m', 'initial'])
    await writeFile(join(repository, 'source.txt'), 'after\n')
    await mkdir(join(repository, 'node_modules', 'package'), { recursive: true })
    await writeFile(join(repository, 'node_modules', 'package', 'index.js'), 'export {}\n')

    const snapshot = await snapshotWorkingTree(repository, join(directory, 'installed.index'))

    expect(git(repository, ['ls-tree', '-r', '--name-only', snapshot]).split('\n')).toEqual([
      '.gitignore',
      'source.txt',
    ])
    expect(git(repository, ['show', `${snapshot}:source.txt`])).toBe('after')
  })

  it('runs each tree from the same path and moves it back', async () => {
    const trial = join(directory, 'trial-worktree')
    const seen: string[] = []
    for (const label of ['base', 'candidate']) {
      await mkdir(join(directory, label))
      await writeFile(join(directory, label, 'label.txt'), label)
    }

    for (const label of ['base', 'candidate', 'base']) {
      seen.push(
        await runInTrialDirectory(join(directory, label), trial, () =>
          readFile(join(trial, 'label.txt'), 'utf8'),
        ),
      )
    }
    await expect(
      runInTrialDirectory(join(directory, 'candidate'), trial, () =>
        Promise.reject(new Error('harness failed')),
      ),
    ).rejects.toThrow('harness failed')

    expect(seen).toEqual(['base', 'candidate', 'base'])
    expect(await exists(trial)).toBe(false)
    expect(await readFile(join(directory, 'base', 'label.txt'), 'utf8')).toBe('base')
    expect(await readFile(join(directory, 'candidate', 'label.txt'), 'utf8')).toBe('candidate')
  })

  it('refuses to move a tree onto another tree at the trial path', async () => {
    const trial = join(directory, 'trial-worktree')
    await mkdir(join(directory, 'base'))
    await writeFile(join(directory, 'base', 'label.txt'), 'base')
    await mkdir(trial)
    await writeFile(join(trial, 'label.txt'), 'left behind')
    let ran = false

    await expect(
      runInTrialDirectory(join(directory, 'base'), trial, async () => {
        ran = true
      }),
    ).rejects.toThrow()

    expect(ran).toBe(false)
    expect(await readFile(join(directory, 'base', 'label.txt'), 'utf8')).toBe('base')
    expect(await readFile(join(trial, 'label.txt'), 'utf8')).toBe('left behind')
  })
})
