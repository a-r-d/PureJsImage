import { spawn } from 'node:child_process'
import { copyFile, rename } from 'node:fs/promises'
import { resolve } from 'node:path'

export interface CommandResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

export const runCommand = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<CommandResult> =>
  new Promise((resolveCommand, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', (code) => resolveCommand({ code: code ?? 1, stdout, stderr }))
  })

export const checkedCommand = async (
  command: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): Promise<string> => {
  const result = await runCommand(command, args, env === undefined ? { cwd } : { cwd, env })
  if (result.code !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr.trim()}`)
  }
  return result.stdout.trim()
}

/**
 * Records the working tree as a commit object, including untracked files that are not ignored.
 * It stages into a copy of the checkout's index, so the checkout's index, HEAD, branches and
 * stash stay unchanged. Nothing refers to the commit, so git removes it later.
 */
export const snapshotWorkingTree = async (
  repositoryDirectory: string,
  indexPath: string,
): Promise<string> => {
  const checkoutIndex = await checkedCommand(
    'git',
    ['rev-parse', '--git-path', 'index'],
    repositoryDirectory,
  )
  await copyFile(resolve(repositoryDirectory, checkoutIndex), indexPath)
  const env = {
    ...process.env,
    GIT_INDEX_FILE: indexPath,
    GIT_AUTHOR_NAME: 'hillclimb',
    GIT_AUTHOR_EMAIL: 'hillclimb@localhost',
    GIT_COMMITTER_NAME: 'hillclimb',
    GIT_COMMITTER_EMAIL: 'hillclimb@localhost',
  }
  // Agent worktrees often link node_modules to the main checkout, and the `node_modules/` ignore
  // rule does not match a link. Leave it out so both trees find packages the same way, from the
  // checkout's node_modules above the run directory. Naming node_modules in the `add` pathspec
  // fails when it is an ignored directory, so remove any link from the temporary index instead.
  await checkedCommand('git', ['add', '--all', '--', '.'], repositoryDirectory, env)
  await checkedCommand(
    'git',
    ['rm', '--cached', '--ignore-unmatch', '--quiet', '-r', '--', 'node_modules'],
    repositoryDirectory,
    env,
  )
  const tree = await checkedCommand('git', ['write-tree'], repositoryDirectory, env)
  return checkedCommand(
    'git',
    ['commit-tree', '--no-gpg-sign', '-p', 'HEAD', '-m', 'Hillclimb candidate snapshot', tree],
    repositoryDirectory,
    env,
  )
}

/**
 * Moves a prepared tree to the shared trial path for one run and moves it back afterwards.
 * Base and candidate then load modules, fixtures and the worker from the same absolute path.
 * The rename fails if another tree is still at the trial path.
 */
export const runInTrialDirectory = async <T>(
  directory: string,
  trialDirectory: string,
  run: () => Promise<T>,
): Promise<T> => {
  await rename(directory, trialDirectory)
  try {
    return await run()
  } finally {
    await rename(trialDirectory, directory)
  }
}
